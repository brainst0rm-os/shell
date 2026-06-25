/**
 * 9.10a — chunked / streamed upload session state machine.
 *
 * The single-envelope `uploadFile` (this same worker) caps at 25 MiB because
 * the bytes have to fit in one IPC envelope. Anything larger (video, big
 * PDF, raw images) has to arrive in pieces. This module is the per-token
 * session machinery the four broker methods drive:
 *
 *   begin({ name, mime?, totalBytes? })
 *     → mint an opaque uploadToken + create `<files>/.uploads/<token>` (empty)
 *       + start an incremental SHA-256 over the stream
 *       + arm an idle reaper
 *
 *   chunk({ uploadToken, seq, bytesBase64 })
 *     → append to the open WriteStream, advance the hasher, bump seq.
 *       Re-send of the most recent seq with identical bytes is a no-op
 *       (idempotent retry). Out-of-order seq, cross-app token, byte-ceiling
 *       overrun → `Invalid`.
 *
 *   commit({ uploadToken, expectedHash? })
 *     → close the stream; verify expectedHash if supplied; atomic-rename
 *       the .tmp into `<files>/<sha256>.<ext>` (content-addressed store —
 *       same destination as `uploadFile`, so dedupe works across the two
 *       paths); return the `UploadedFile` shape.
 *
 *   abort({ uploadToken })
 *     → unlink the .tmp + drop the session. Silent on unknown token (no
 *       leak of which tokens exist).
 *
 * Ceilings:
 *   - 2 GiB per token (`MAX_UPLOAD_BYTES`). v1 protects against runaway;
 *     legitimate video is well under this.
 *   - 4 concurrent open sessions per app (`MAX_OUTSTANDING_PER_APP`). One
 *     misbehaving app can't open thousands of .tmp files.
 *   - 5 minute idle timeout (`IDLE_TIMEOUT_MS`). A session with no chunk /
 *     commit / abort for that long is reaped + its tmp deleted. Resets
 *     on every chunk.
 *
 * Crash recovery: `gcOrphans(appId)` wipes every entry in `<files>/.uploads/`
 * for that app. The store calls it lazily on the first `begin` per app per
 * worker session, so a process that died mid-upload can't leave stale tmps
 * forever.
 *
 * Path layout: temps live at `<vault>/data/apps/<appId>/files/.uploads/<token>`.
 * The `brainstorm://app-file/...` protocol regex requires `<64-hex>.<ext>`
 * (main/index.ts), so files under `.uploads/` are unreachable from any
 * renderer — they only exist on disk between begin and commit.
 *
 * Capability: same `storage.kv` as the single-envelope `uploadFile`. No new
 * cap surface — the broker check on the call already binds the upload to an
 * app the user installed.
 */

import { type Hash, createHash, randomBytes } from "node:crypto";
import { type WriteStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import { extname, join } from "node:path";
import { makeWorkerError } from "./worker-error";

/** Subdir under each app's `files/` that holds in-flight .tmp uploads. The
 *  leading dot keeps it out of any naive `readdir` listing and the
 *  `app-file` protocol regex won't ever route to it. */
export const UPLOAD_TMP_SUBDIR = ".uploads";

/** Advisory chunk size returned by `begin`. Apps SHOULD use this; the worker
 *  doesn't enforce a per-chunk ceiling beyond the per-token total. 1 MiB
 *  balances envelope memory cost vs round-trip overhead. */
export const CHUNK_BYTES_HINT = 1 * 1024 * 1024;

/** Hard per-token ceiling. Generous v1 — well above any reasonable video —
 *  but bounded so an app can't fill the disk in a tight loop. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

/** Concurrent open sessions per app. */
export const MAX_OUTSTANDING_PER_APP = 4;

/** Idle reaper deadline (ms). Resets on every successful chunk / read. */
export const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/** Same allow-list as `uploadFile` — keep them in sync so both paths reject
 *  the same kinds of file. Defined here so callers can extend the chunked
 *  path without forking the list. */
export const UPLOAD_ALLOWED_EXTS: ReadonlySet<string> = new Set([
	".png",
	".jpg",
	".jpeg",
	".webp",
	".gif",
	".avif",
	".svg",
	".mp4",
	".webm",
	".mov",
	".m4a",
	".mp3",
	".wav",
	".ogg",
	".pdf",
]);

export interface UploadedFile {
	url: string;
	hash: string;
	ext: string;
	size: number;
	mime: string;
}

export interface UploadBeginArgs {
	name?: unknown;
	mime?: unknown;
	totalBytes?: unknown;
}

export interface UploadChunkArgs {
	uploadToken?: unknown;
	seq?: unknown;
	bytesBase64?: unknown;
}

export interface UploadCommitArgs {
	uploadToken?: unknown;
	expectedHash?: unknown;
}

export interface UploadAbortArgs {
	uploadToken?: unknown;
}

export interface UploadStore {
	begin(appId: string, args: UploadBeginArgs): Promise<{ uploadToken: string; chunkBytes: number }>;
	chunk(appId: string, args: UploadChunkArgs): Promise<{ ok: true; receivedBytes: number }>;
	commit(appId: string, args: UploadCommitArgs): Promise<UploadedFile>;
	abort(appId: string, args: UploadAbortArgs): Promise<void>;
	/** Drop every in-flight session for `appId` (uninstall hook, vault close).
	 *  Deletes the .tmp files. Safe to call concurrently with a vault rebind. */
	disposeAllForApp(appId: string): Promise<number>;
	/** Drop EVERY session across all apps. Vault close. */
	disposeAll(): Promise<void>;
	/** Live session count, for audit / tests. */
	readonly size: number;
}

export interface UploadStoreOptions {
	/** The active vault path, or null when no session is open (→ Unavailable). */
	vaultPath: () => string | null;
	/** Clock — overridable for deterministic idle-timeout tests. */
	now?: () => number;
	/** Random token generator — overridable for deterministic tests. Must
	 *  produce a non-empty, filesystem-safe string. */
	randomToken?: () => string;
	/** Schedule the idle reaper. Overridable for fake-timer tests. Default
	 *  is `setTimeout(..., IDLE_TIMEOUT_MS).unref()`. */
	scheduleIdleReap?: (cb: () => void, ms: number) => IdleReapHandle;
}

export interface IdleReapHandle {
	cancel(): void;
}

const DEFAULT_TOKEN_GEN = (): string => `up_${randomBytes(24).toString("base64url")}`;

const DEFAULT_REAP_SCHEDULER = (cb: () => void, ms: number): IdleReapHandle => {
	const t = setTimeout(cb, ms);
	if (typeof (t as { unref?: () => void }).unref === "function") {
		(t as { unref: () => void }).unref();
	}
	return {
		cancel: () => clearTimeout(t),
	};
};

interface Session {
	token: string;
	appId: string;
	tmpPath: string;
	ext: string;
	mime: string;
	declaredTotalBytes: number | null;
	hasher: Hash;
	stream: WriteStream;
	receivedBytes: number;
	nextSeq: number;
	/** Last accepted chunk's raw bytes — kept ONLY so an idempotent retry of
	 *  the previous seq can verify the caller is re-sending byte-identical
	 *  content (a cheaper signal than re-hashing every chunk: the running
	 *  hasher already covered them, so checking equality here is the only
	 *  remaining job). Cleared on the next forward chunk + on tearDown. */
	lastChunkBuf: Buffer | null;
	reaper: IdleReapHandle | null;
	createdAt: number;
}

function invalid(message: string): Error {
	return makeWorkerError("Invalid", message);
}

function unavailable(message: string): Error {
	return makeWorkerError("Unavailable", message);
}

function isSafeAppId(appId: string): boolean {
	return /^[A-Za-z0-9._-]+$/.test(appId);
}

function readString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw invalid(`upload: ${field} must be a non-empty string`);
	}
	return value;
}

function readOptionalString(value: unknown, field: string): string {
	if (value === undefined || value === null) return "";
	if (typeof value !== "string") {
		throw invalid(`upload: ${field} must be a string when provided`);
	}
	return value;
}

function readSeq(value: unknown): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		throw invalid("uploadChunk: seq must be a non-negative integer");
	}
	return value;
}

function readTotalBytes(value: unknown): number | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw invalid("uploadBegin: totalBytes must be a non-negative number when provided");
	}
	if (value > MAX_UPLOAD_BYTES) {
		throw invalid(`uploadBegin: totalBytes exceeds ${MAX_UPLOAD_BYTES}`);
	}
	return Math.floor(value);
}

function readBytesBase64(value: unknown): Buffer {
	if (typeof value !== "string") {
		throw invalid("uploadChunk: bytesBase64 must be a base64 string");
	}
	return Buffer.from(value, "base64");
}

export function createUploadStore(options: UploadStoreOptions): UploadStore {
	const now = options.now ?? Date.now;
	const genToken = options.randomToken ?? DEFAULT_TOKEN_GEN;
	const scheduleReap = options.scheduleIdleReap ?? DEFAULT_REAP_SCHEDULER;

	const sessions = new Map<string, Session>();
	const sessionsByApp = new Map<string, Set<string>>();
	const gcDoneForApp = new Set<string>();

	function requireVault(): string {
		const path = options.vaultPath();
		if (!path) throw unavailable("upload: storage worker has no active vault");
		return path;
	}

	function uploadDirFor(appId: string): string {
		if (!isSafeAppId(appId)) {
			throw invalid(`unsafe appId for upload path: ${appId}`);
		}
		return join(requireVault(), "data", "apps", appId, "files", UPLOAD_TMP_SUBDIR);
	}

	function filesDirFor(appId: string): string {
		if (!isSafeAppId(appId)) {
			throw invalid(`unsafe appId for upload path: ${appId}`);
		}
		return join(requireVault(), "data", "apps", appId, "files");
	}

	async function gcOrphansOnce(appId: string): Promise<void> {
		if (gcDoneForApp.has(appId)) return;
		gcDoneForApp.add(appId);
		const dir = uploadDirFor(appId);
		let entries: string[];
		try {
			entries = await readdir(dir);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
		await Promise.all(
			entries.map((name) =>
				unlink(join(dir, name)).catch((error: NodeJS.ErrnoException) => {
					if (error.code !== "ENOENT") {
						console.warn(`[brainstorm] upload-session: gc could not unlink ${name}:`, error);
					}
				}),
			),
		);
	}

	function trackSession(session: Session): void {
		sessions.set(session.token, session);
		let set = sessionsByApp.get(session.appId);
		if (!set) {
			set = new Set<string>();
			sessionsByApp.set(session.appId, set);
		}
		set.add(session.token);
	}

	function untrackSession(session: Session): void {
		sessions.delete(session.token);
		const set = sessionsByApp.get(session.appId);
		if (set) {
			set.delete(session.token);
			if (set.size === 0) sessionsByApp.delete(session.appId);
		}
	}

	async function tearDown(session: Session, unlinkTmp: boolean): Promise<void> {
		session.reaper?.cancel();
		session.reaper = null;
		try {
			session.stream.destroy();
		} catch {
			// best-effort
		}
		await new Promise<void>((resolve) => {
			if (session.stream.destroyed) {
				resolve();
				return;
			}
			session.stream.once("close", () => resolve());
			session.stream.once("error", () => resolve());
		});
		if (unlinkTmp) {
			await unlink(session.tmpPath).catch((error: NodeJS.ErrnoException) => {
				if (error.code !== "ENOENT") {
					console.warn(`[brainstorm] upload-session: could not unlink ${session.tmpPath}:`, error);
				}
			});
		}
		untrackSession(session);
	}

	function armReaper(session: Session): void {
		session.reaper?.cancel();
		session.reaper = scheduleReap(() => {
			void tearDown(session, true);
		}, IDLE_TIMEOUT_MS);
	}

	function resolveOwnedSession(appId: string, token: string, method: string): Session {
		const session = sessions.get(token);
		if (!session || session.appId !== appId) {
			throw invalid(`${method}: uploadToken is unknown, expired, or not yours`);
		}
		return session;
	}

	async function writeBufferToStream(stream: WriteStream, buf: Buffer): Promise<void> {
		const ok = stream.write(buf);
		if (ok) return;
		await new Promise<void>((resolve) => stream.once("drain", () => resolve()));
	}

	async function closeStream(stream: WriteStream): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			stream.end((error: Error | null | undefined) => {
				if (error) reject(error);
				else resolve();
			});
		});
	}

	async function begin(
		appId: string,
		args: UploadBeginArgs,
	): Promise<{ uploadToken: string; chunkBytes: number }> {
		const name = readString(args.name, "name");
		const mime = readOptionalString(args.mime, "mime");
		const declaredTotalBytes = readTotalBytes(args.totalBytes);

		const ext = extname(name).toLowerCase();
		if (!UPLOAD_ALLOWED_EXTS.has(ext)) {
			throw invalid(`uploadBegin: unsupported extension: ${ext}`);
		}

		await gcOrphansOnce(appId);

		const open = sessionsByApp.get(appId);
		if (open && open.size >= MAX_OUTSTANDING_PER_APP) {
			throw invalid(
				`uploadBegin: ${appId} has too many concurrent uploads (max ${MAX_OUTSTANDING_PER_APP})`,
			);
		}

		const dir = uploadDirFor(appId);
		await mkdir(dir, { recursive: true });

		let token = genToken();
		while (sessions.has(token)) token = genToken();
		const tmpPath = join(dir, token);

		const stream = createWriteStream(tmpPath, { flags: "wx" });
		await new Promise<void>((resolve, reject) => {
			const onOpen = () => {
				stream.off("error", onError);
				resolve();
			};
			const onError = (error: Error) => {
				stream.off("open", onOpen);
				reject(error);
			};
			stream.once("open", onOpen);
			stream.once("error", onError);
		});

		const session: Session = {
			token,
			appId,
			tmpPath,
			ext,
			mime,
			declaredTotalBytes,
			hasher: createHash("sha256"),
			stream,
			receivedBytes: 0,
			nextSeq: 0,
			lastChunkBuf: null,
			reaper: null,
			createdAt: now(),
		};
		trackSession(session);
		armReaper(session);

		return { uploadToken: token, chunkBytes: CHUNK_BYTES_HINT };
	}

	async function chunk(
		appId: string,
		args: UploadChunkArgs,
	): Promise<{ ok: true; receivedBytes: number }> {
		const token = readString(args.uploadToken, "uploadToken");
		const seq = readSeq(args.seq);
		const buf = readBytesBase64(args.bytesBase64);

		const session = resolveOwnedSession(appId, token, "uploadChunk");

		// Idempotent retry of the last seq with the same bytes — no-op.
		if (seq === session.nextSeq - 1) {
			if (session.lastChunkBuf !== null && buf.equals(session.lastChunkBuf)) {
				armReaper(session);
				return { ok: true, receivedBytes: session.receivedBytes };
			}
			throw invalid("uploadChunk: replay of seq with different bytes");
		}

		if (seq !== session.nextSeq) {
			throw invalid(`uploadChunk: out-of-order seq (got ${seq}, expected ${session.nextSeq})`);
		}

		const newReceived = session.receivedBytes + buf.byteLength;
		if (newReceived > MAX_UPLOAD_BYTES) {
			throw invalid(`uploadChunk: byte ceiling exceeded (${newReceived} > ${MAX_UPLOAD_BYTES})`);
		}
		if (session.declaredTotalBytes !== null && newReceived > session.declaredTotalBytes) {
			throw invalid("uploadChunk: bytes exceed declared totalBytes");
		}

		await writeBufferToStream(session.stream, buf);
		session.hasher.update(buf);
		session.receivedBytes = newReceived;
		session.lastChunkBuf = buf;
		session.nextSeq = seq + 1;
		armReaper(session);

		return { ok: true, receivedBytes: session.receivedBytes };
	}

	async function commit(appId: string, args: UploadCommitArgs): Promise<UploadedFile> {
		const token = readString(args.uploadToken, "uploadToken");
		const session = resolveOwnedSession(appId, token, "uploadCommit");

		const expectedHash =
			args.expectedHash === undefined || args.expectedHash === null
				? null
				: readString(args.expectedHash, "expectedHash");

		if (session.receivedBytes === 0) {
			await tearDown(session, true);
			throw invalid("uploadCommit: no bytes received");
		}
		if (session.declaredTotalBytes !== null && session.receivedBytes !== session.declaredTotalBytes) {
			await tearDown(session, true);
			throw invalid(
				`uploadCommit: received ${session.receivedBytes} bytes; declared totalBytes was ${session.declaredTotalBytes}`,
			);
		}

		session.reaper?.cancel();
		session.reaper = null;

		// Past this point the reaper is cancelled, so ANY thrown error must
		// untrack + unlink the tmp explicitly — otherwise the session pins
		// itself in `sessions` + `sessionsByApp` forever and counts against
		// `MAX_OUTSTANDING_PER_APP`. Disk-fill / rename-cross-device /
		// stream-close errors all reach this guard.
		try {
			await closeStream(session.stream);

			const hash = session.hasher.digest("hex");
			if (expectedHash !== null && expectedHash !== hash) {
				throw invalid("uploadCommit: expectedHash does not match computed hash");
			}

			const filesDir = filesDirFor(appId);
			await mkdir(filesDir, { recursive: true });
			const targetName = `${hash}${session.ext}`;
			const targetPath = join(filesDir, targetName);

			// Content-addressed dedupe: if a previous upload already wrote
			// these bytes (via this path or via single-envelope
			// `uploadFile`), drop the .tmp instead of overwriting the
			// canonical copy.
			const alreadyExists = await stat(targetPath).then(
				(s) => s.isFile(),
				() => false,
			);
			if (alreadyExists) {
				await unlink(session.tmpPath).catch(() => undefined);
			} else {
				await rename(session.tmpPath, targetPath);
			}
			untrackSession(session);

			const url = `brainstorm://app-file/${encodeURIComponent(appId)}/${encodeURIComponent(targetName)}`;
			return {
				url,
				hash,
				ext: session.ext,
				size: session.receivedBytes,
				mime: session.mime,
			};
		} catch (error) {
			await unlink(session.tmpPath).catch(() => undefined);
			untrackSession(session);
			throw error;
		}
	}

	async function abort(appId: string, args: UploadAbortArgs): Promise<void> {
		// Silent on unknown — abort is also the cleanup verb the SDK calls in
		// its `finally`, so a token already torn down by an idle reap shouldn't
		// surface as an error.
		if (args.uploadToken === undefined || args.uploadToken === null) return;
		const token =
			typeof args.uploadToken === "string" && args.uploadToken.length > 0 ? args.uploadToken : null;
		if (token === null) return;
		const session = sessions.get(token);
		if (!session || session.appId !== appId) return;
		await tearDown(session, true);
	}

	async function disposeAllForApp(appId: string): Promise<number> {
		const set = sessionsByApp.get(appId);
		if (!set || set.size === 0) return 0;
		const tokens = [...set];
		await Promise.all(
			tokens.map((token) => {
				const session = sessions.get(token);
				if (!session) return Promise.resolve();
				return tearDown(session, true);
			}),
		);
		return tokens.length;
	}

	async function disposeAll(): Promise<void> {
		const tokens = [...sessions.keys()];
		await Promise.all(
			tokens.map((token) => {
				const session = sessions.get(token);
				if (!session) return Promise.resolve();
				return tearDown(session, true);
			}),
		);
		gcDoneForApp.clear();
	}

	return {
		begin,
		chunk,
		commit,
		abort,
		disposeAllForApp,
		disposeAll,
		get size() {
			return sessions.size;
		},
	};
}
