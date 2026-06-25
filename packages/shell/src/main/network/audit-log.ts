/**
 * Net-1a step 2 — append-only audit log for the network broker.
 *
 * Per ` §Logging hygiene`: every
 * brokered network request lands one JSON-lines record. The record is
 * **metadata only** — never the request body, never the response body,
 * never URL query strings. Path is preserved up to (not including) the
 * query string so the user can audit "which API endpoints did this app
 * hit", but `?token=secret` style leakage stays contained.
 *
 * The audit log is the only egress side-channel the user can read after
 * the fact; it's the load-bearing surface the doc-38 "Network panel"
 * (Settings → Privacy → Network, post-Net-1) renders. Schema must stay
 * stable across iterations — adding a field is fine; renaming or
 * narrowing one breaks the renderer.
 */

import { appendFile, mkdir, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";

export enum NetworkAuditOutcome {
	/** Request reached the network and completed with an HTTP response. */
	Completed = "completed",
	/** Request rejected before any byte hit the network (SSRF, cap, scheme). */
	Refused = "refused",
	/** Request started but the broker aborted it (size cap / time cap / disconnect). */
	Aborted = "aborted",
	/** The underlying fetch threw (DNS failure, TLS error, network drop). */
	Errored = "errored",
}

export type NetworkAuditRecord = {
	/** Wall-clock ms since epoch at the moment the record was written. */
	readonly ts: number;
	/** Calling app's stable id, or `"shell"` for shell-internal traffic
	 *  (update checks, telemetry, etc — post-Net-1). */
	readonly appId: string;
	/** HTTP method as the caller requested. Upper-cased. */
	readonly method: string;
	/** Lower-cased URL hostname (or `host:port` when non-default). */
	readonly host: string;
	/** URL path up to (not including) any `?` query string or `#` fragment. */
	readonly path: string;
	/** Final HTTP status code, or `0` when the request never got a response. */
	readonly status: number;
	/** Total response body bytes read (post-decode if Content-Encoding stripped). */
	readonly bytes: number;
	/** Wall-clock ms from broker entry to outcome. */
	readonly durationMs: number;
	/** Tag explaining how the request resolved. */
	readonly outcome: NetworkAuditOutcome;
	/** Short machine-readable reason — populated on `Refused` / `Aborted` /
	 *  `Errored` (e.g. `"non-http-scheme"`, `"size-cap"`, `"private-ip"`).
	 *  Empty string on a clean `Completed`. */
	readonly reason: string;
};

/**
 * Strip a URL's query + fragment. The broker stores the path because
 * "which endpoints does this app talk to" is the central audit question;
 * we drop the query because URL params routinely carry tokens / search
 * terms / session ids the user wouldn't want to surface in a side log.
 */
export function pathOf(url: string): string {
	try {
		const parsed = new URL(url);
		return parsed.pathname.length > 0 ? parsed.pathname : "/";
	} catch {
		return "";
	}
}

/**
 * `host:port` when the port isn't the scheme default; bare host otherwise.
 * Matches the canonical form `URL` would produce minus the trailing slash.
 */
export function hostOf(url: string): string {
	try {
		const parsed = new URL(url);
		const port = parsed.port.length > 0 ? Number(parsed.port) : -1;
		const defaultPort = parsed.protocol === "https:" ? 443 : 80;
		const host = parsed.hostname.toLowerCase();
		return port < 0 || port === defaultPort ? host : `${host}:${port}`;
	} catch {
		return "";
	}
}

/** Real network-egress schemes. `chrome-extension:` / `devtools:` / `blob:` /
 *  `data:` / `about:` / `file:` requests fire `onBeforeRequest` too, but their
 *  "hostname" is an opaque id (or empty), not a contacted host — folding them
 *  into the per-host egress table surfaces gibberish like a raw extension id. */
const NETWORK_EGRESS_SCHEMES = new Set(["http:", "https:", "ws:", "wss:"]);

/** `hostOf`, but only for actual over-the-wire schemes — empty string for
 *  extension / devtools / blob / data URLs so they never enter the egress
 *  aggregate. */
export function networkEgressHostOf(url: string): string {
	try {
		if (!NETWORK_EGRESS_SCHEMES.has(new URL(url).protocol)) return "";
	} catch {
		return "";
	}
	return hostOf(url);
}

/** Append-only sink shape. The shell's production path writes to a JSONL
 *  file on disk; tests inject a memory buffer. */
export type NetworkAuditSink = (line: string) => Promise<void> | void;

/** Default rotation threshold for the production file sink — 10 MiB.
 *  Past this, the current `.jsonl` is renamed to `.1.jsonl` (overwriting
 *  any prior `.1.jsonl`) and a fresh empty file is started. The Privacy
 *  Settings reader (Net-1f) will surface both files when it lands. */
export const DEFAULT_AUDIT_ROTATE_BYTES = 10 * 1024 * 1024;

/** Optional knobs for `makeFileAuditSink`. `rotateBytes` is the size
 *  past which the sink rotates the file. `now` is injected for tests;
 *  unused in production (rotation is size-driven, not time-driven). */
export type FileAuditSinkOptions = {
	readonly rotateBytes?: number;
};

/** Build a sink that appends to a file, creating parent dirs as needed
 *  and rotating once the file exceeds `rotateBytes` (10 MiB default).
 *  Rotation strategy: `network-audit.jsonl` → `network-audit.1.jsonl`
 *  (overwriting any older `.1.jsonl`), then starting a fresh empty
 *  `network-audit.jsonl`. One generation of history kept — the Net-1
 *  audit panel is for "what just happened" investigation, not long-
 *  term forensics; older history evicts automatically. */
export function makeFileAuditSink(
	path: string,
	options: FileAuditSinkOptions = {},
): NetworkAuditSink {
	const rotateBytes = options.rotateBytes ?? DEFAULT_AUDIT_ROTATE_BYTES;
	const rotatedPath = rotatedPathFor(path);
	let ensured = false;
	// Tracks the current file's size locally so we don't `stat()` on
	// every append. The first write `stat`s once to pick up an existing
	// file from a previous session; subsequent writes add the line's
	// byte length. A failed write keeps the counter — the next write
	// re-stat-recovers if it's catastrophically off (rare).
	let currentBytes = -1;
	return async (line: string): Promise<void> => {
		if (!ensured) {
			await mkdir(dirname(path), { recursive: true });
			ensured = true;
		}
		if (currentBytes < 0) {
			try {
				const s = await stat(path);
				currentBytes = s.size;
			} catch {
				currentBytes = 0;
			}
		}
		const lineBytes = Buffer.byteLength(line, "utf8") + 1; // +1 for the trailing newline
		if (currentBytes + lineBytes > rotateBytes && currentBytes > 0) {
			// Roll the current file to `.1.jsonl`, overwriting any prior
			// rotation. `rename` replaces atomically on POSIX + Windows
			// — no half-rotated state visible to a concurrent reader.
			try {
				// Drop a stale `.1.jsonl` first so `rename` doesn't fail on
				// Windows (where rename-onto-existing isn't atomic).
				await unlink(rotatedPath).catch(() => undefined);
				await rename(path, rotatedPath);
				currentBytes = 0;
			} catch (error) {
				// Rotation failure is non-fatal — keep appending; the file
				// just grows past the cap for this session. Logged so a
				// disk-full / permission issue is visible.
				console.warn(`[network/audit] rotation failed: ${(error as Error).message}`);
			}
		}
		await appendFile(path, `${line}\n`, "utf8");
		currentBytes += lineBytes;
	};
}

/** Compose the rotated-path sibling of an audit file: `foo.jsonl` ->
 *  `foo.1.jsonl`. Falls back to `<path>.1` when there's no recognisable
 *  extension. Exported for tests. */
export function rotatedPathFor(path: string): string {
	const dot = path.lastIndexOf(".");
	if (dot <= 0 || dot < path.length - 8) return `${path}.1`;
	return `${path.slice(0, dot)}.1${path.slice(dot)}`;
}

/**
 * Write one record. Best-effort: a sink throw is logged + swallowed —
 * the broker's response to the caller MUST NOT depend on audit-log
 * availability (a full disk shouldn't break network access). The caller
 * gets the network result; the audit gap is visible via the missing row.
 */
export async function recordAudit(
	sink: NetworkAuditSink,
	record: NetworkAuditRecord,
): Promise<void> {
	try {
		const line = JSON.stringify(record);
		await sink(line);
	} catch (error) {
		console.warn(`[network/audit] sink failed: ${(error as Error).message}`);
	}
}

/** Net-1f — knobs for `readAuditRecords`. The reader pulls from the
 *  rotated archive AND the current file, sorts newest-first, filters by
 *  timestamp window, and caps at `limit`. `now` is injected for tests so
 *  the default 24h window is deterministic. */
export type ReadAuditOptions = {
	/** Inclusive lower bound (ms since epoch). Records older than this are
	 *  dropped. Default: 24h ago per doc-38 §Network panel "last 24h". */
	readonly fromMs?: number;
	/** Inclusive upper bound (ms since epoch). Records newer than this are
	 *  dropped. Default: `now`. */
	readonly toMs?: number;
	/** Cap on records returned (post-filter). Default 1000 per doc-38
	 *  §Network panel "Recent requests — capped to 1000 entries". */
	readonly limit?: number;
	/** Injected clock — `Date.now` by default. Tests pin the window. */
	readonly now?: () => number;
};

/** Default audit-read window — 24 hours per doc-38 §Network panel. */
export const DEFAULT_READ_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Default audit-read row cap — 1000 entries per doc-38 §Network panel. */
export const DEFAULT_READ_LIMIT = 1000;

/** Read the audit log + its rotated sibling, returning records that
 *  fall inside `[fromMs, toMs]` newest-first, capped at `limit`. The
 *  reader is fail-soft: missing files return [], malformed lines are
 *  skipped (corrupted lines never break the panel), and any read error
 *  short-circuits to []. Net-1f surface; never broker-exposed.
 *
 *  Implementation note: we read both files into memory and sort once.
 *  The 10 MiB cap × 2 generations bounds memory at ~20 MiB worst-case;
 *  the typical log fits in a few KiB. We don't stream because the
 *  filter+sort needs the full set anyway and the read happens off the
 *  hot path (Settings panel open, not per-request). */
export async function readAuditRecords(
	auditPath: string,
	options: ReadAuditOptions = {},
): Promise<readonly NetworkAuditRecord[]> {
	const now = options.now ?? Date.now;
	const nowMs = now();
	const toMs = options.toMs ?? nowMs;
	const fromMs = options.fromMs ?? nowMs - DEFAULT_READ_WINDOW_MS;
	const limit = options.limit ?? DEFAULT_READ_LIMIT;
	if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) return [];
	if (!Number.isInteger(limit) || limit < 0) return [];

	const rotated = rotatedPathFor(auditPath);
	const [current, archive] = await Promise.all([readAuditFile(auditPath), readAuditFile(rotated)]);
	const merged: NetworkAuditRecord[] = [];
	for (const rec of archive) {
		if (rec.ts >= fromMs && rec.ts <= toMs) merged.push(rec);
	}
	for (const rec of current) {
		if (rec.ts >= fromMs && rec.ts <= toMs) merged.push(rec);
	}
	merged.sort((a, b) => b.ts - a.ts);
	return merged.slice(0, limit);
}

/** Filter a list of audit records to those with a `Refused` / `Aborted` /
 *  `Errored` outcome — the "Blocked requests" section of the Net-1f
 *  panel. Pure; exported so the panel can pivot on a single fetch. */
export function filterBlockedRecords(
	records: readonly NetworkAuditRecord[],
): readonly NetworkAuditRecord[] {
	return records.filter((rec) => rec.outcome !== NetworkAuditOutcome.Completed);
}

/** Per-app aggregate over the last `windowMs` of audit records — used
 *  by the Net-1f Settings → Privacy → Network panel's "Per-app egress"
 *  section. Returns one row per app with last-seen wall-clock, byte
 *  totals (response only — request bodies aren't audited per
 *  doc-38 §Logging hygiene), and top-N hosts by count. Pure. */
export type PerAppHostSummary = {
	readonly host: string;
	readonly count: number;
};

export type PerAppNetworkSummary = {
	readonly appId: string;
	readonly lastSeenMs: number;
	readonly requestCount: number;
	readonly sentBytes: number;
	readonly receivedBytes: number;
	readonly topHosts: readonly PerAppHostSummary[];
};

/** Default per-app top-host cap. Doc-38 §Network panel says "top 10
 *  hosts contacted". */
export const DEFAULT_TOP_HOSTS_PER_APP = 10;

/** Compute per-app summary rows from a flat list of records. The caller
 *  pre-filters the records by time window (the 7-day window for doc-38
 *  §Per-app egress is set in the IPC handler by `readAuditRecords({fromMs: now - 7d})`).
 *  Pure; sortable + testable. */
export function summarizePerApp(
	records: readonly NetworkAuditRecord[],
	options: { readonly topHostsPerApp?: number } = {},
): readonly PerAppNetworkSummary[] {
	const topN = options.topHostsPerApp ?? DEFAULT_TOP_HOSTS_PER_APP;
	const byApp = new Map<
		string,
		{
			lastSeenMs: number;
			requestCount: number;
			sentBytes: number;
			receivedBytes: number;
			hostCounts: Map<string, number>;
		}
	>();
	for (const rec of records) {
		let bucket = byApp.get(rec.appId);
		if (!bucket) {
			bucket = {
				lastSeenMs: 0,
				requestCount: 0,
				sentBytes: 0,
				receivedBytes: 0,
				hostCounts: new Map(),
			};
			byApp.set(rec.appId, bucket);
		}
		bucket.lastSeenMs = Math.max(bucket.lastSeenMs, rec.ts);
		bucket.requestCount += 1;
		// Request body bytes aren't audited (doc-38 §Logging hygiene), so
		// `sentBytes` here is a derived approximation: assume zero for now
		// and treat `bytes` as response bytes. Future audit-log schema
		// growth can split these; the field is in place for that.
		bucket.receivedBytes += rec.bytes;
		if (rec.host.length > 0) {
			bucket.hostCounts.set(rec.host, (bucket.hostCounts.get(rec.host) ?? 0) + 1);
		}
	}
	const out: PerAppNetworkSummary[] = [];
	for (const [appId, bucket] of byApp) {
		const topHosts: PerAppHostSummary[] = Array.from(bucket.hostCounts.entries())
			.map(([host, count]) => ({ host, count }))
			.sort((a, b) => {
				if (b.count !== a.count) return b.count - a.count;
				return a.host.localeCompare(b.host);
			})
			.slice(0, topN);
		out.push({
			appId,
			lastSeenMs: bucket.lastSeenMs,
			requestCount: bucket.requestCount,
			sentBytes: bucket.sentBytes,
			receivedBytes: bucket.receivedBytes,
			topHosts,
		});
	}
	out.sort((a, b) => b.lastSeenMs - a.lastSeenMs);
	return out;
}

/** Type guard for one audit record. Tolerates extra fields (forward
 *  compatibility) and rejects malformed shapes (a corrupted line or a
 *  half-written tail). */
function isValidAuditRecord(input: unknown): input is NetworkAuditRecord {
	if (!input || typeof input !== "object") return false;
	const raw = input as Record<string, unknown>;
	if (typeof raw.ts !== "number" || !Number.isFinite(raw.ts)) return false;
	if (typeof raw.appId !== "string") return false;
	if (typeof raw.method !== "string") return false;
	if (typeof raw.host !== "string") return false;
	if (typeof raw.path !== "string") return false;
	if (typeof raw.status !== "number") return false;
	if (typeof raw.bytes !== "number") return false;
	if (typeof raw.durationMs !== "number") return false;
	if (typeof raw.outcome !== "string") return false;
	if (typeof raw.reason !== "string") return false;
	return true;
}

async function readAuditFile(path: string): Promise<readonly NetworkAuditRecord[]> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		// ENOENT is the common case (file not created yet) — silent.
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return [];
		console.warn(`[network/audit] read failed for ${path}: ${(error as Error).message}`);
		return [];
	}
	if (text.length === 0) return [];
	const out: NetworkAuditRecord[] = [];
	for (const line of text.split("\n")) {
		if (line.length === 0) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			// Corrupted line — skip silently. Don't poison the rest.
			continue;
		}
		if (isValidAuditRecord(parsed)) out.push(parsed);
	}
	return out;
}
