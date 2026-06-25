/**
 * Storage worker — Node-based `utilityProcess` per docs/shell/12-shell-architecture.md.
 *
 *   Owns: filesystem I/O for app-scoped key/value data. SQLite + Yjs snapshot
 *   surfaces land in later Stage 3 iterations.
 *
 * Storage layout (per-app isolation):
 *
 *   <vault>/data/apps/<appId>/kv.json
 *
 * The worker keeps an in-memory cache per app, flushes on every write
 * (atomic via temp-file rename), and lazy-loads on first access. App
 * identity comes from the envelope (`envelope.app`) which the broker has
 * already verified against the renderer-identity registry.
 *
 * Bootstrap: the main process must call the worker's private `setVault`
 * method once per vault session. Calls that arrive before that point return
 * `Unavailable` so apps can detect the not-yet-ready state cleanly.
 *
 * Runs under `utilityProcess.fork`. Messages are plain objects via
 * `process.parentPort.postMessage`; no Yjs/SQLite/Electron renderer types
 * cross this boundary.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import type { Envelope, EnvelopeReply } from "../../ipc/envelope";
import { makeErrorReply, makeOkReply, validateEnvelope } from "../../ipc/envelope";
import { installWorkerProcessGuards, wireParentPort } from "../worker-runtime";
import { UPLOAD_ALLOWED_EXTS, type UploadStore, createUploadStore } from "./upload-session";
import { makeWorkerError } from "./worker-error";

const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

/** Electron's `process.parentPort` delivers a `MessageEvent`-shaped object to
 *  the 'message' listener — the actual payload lives on `.data`. This is
 *  asymmetric with the parent's `UtilityProcess.on('message', ...)`, which
 *  receives the raw posted value. See electron.d.ts for both signatures. */
type ParentPortMessage = { data: unknown };
type ParentPort = {
	on(event: "message", listener: (event: ParentPortMessage) => void): void;
	postMessage(message: unknown): void;
};

type ProcessWithParentPort = NodeJS.Process & { parentPort?: ParentPort };

let vaultPath: string | null = null;
const cache = new Map<string, Map<string, unknown>>();

const uploadStore: UploadStore = createUploadStore({ vaultPath: () => vaultPath });

const SHELL_SENTINEL_APP = "_shell" as const;

type Handler = (envelope: Envelope) => Promise<unknown> | unknown;

const handlers: Record<string, Handler> = {
	ping: (envelope) => ({ pong: envelope.args[0] ?? null, at: Date.now() }),

	/** Main-process-only: bind the worker to a vault path. Called once per
	 *  session (vault open / switch). Apps cannot reach this method — only
	 *  the main process sends envelopes with `app: "_shell"`; the broker
	 *  never produces that sentinel for renderer-originated calls. */
	setVault: async (envelope) => {
		if (envelope.app !== SHELL_SENTINEL_APP) {
			throw makeWorkerError("Invalid", "storage.setVault is reserved for the main process");
		}
		const arg = envelope.args[0] as { path?: string } | undefined;
		if (!arg || typeof arg.path !== "string" || arg.path.length === 0) {
			throw makeWorkerError("Invalid", "storage.setVault requires { path: string }");
		}
		await uploadStore.disposeAll();
		vaultPath = arg.path;
		cache.clear();
		return { ok: true };
	},

	put: async (envelope) => {
		const { key, value } = readKv(envelope);
		const store = await loadAppStore(envelope.app);
		store.set(key, value);
		await flushAppStore(envelope.app, store);
		return undefined;
	},

	get: async (envelope) => {
		const { key } = readKv(envelope);
		const store = await loadAppStore(envelope.app);
		return store.has(key) ? (store.get(key) ?? null) : null;
	},

	list: async (envelope) => {
		const arg = envelope.args[0] as { prefix?: string } | undefined;
		const prefix = arg?.prefix ?? "";
		const store = await loadAppStore(envelope.app);
		const out: Array<{ key: string; value: unknown }> = [];
		for (const [k, v] of store.entries()) {
			if (k.startsWith(prefix)) out.push({ key: k, value: v });
		}
		return out;
	},

	delete: async (envelope) => {
		const { key } = readKv(envelope);
		const store = await loadAppStore(envelope.app);
		const had = store.delete(key);
		if (had) await flushAppStore(envelope.app, store);
		return had;
	},

	uploadFile: async (envelope) => uploadFileHandler(envelope),

	uploadBegin: async (envelope) =>
		uploadStore.begin(envelope.app, (envelope.args[0] as Record<string, unknown> | undefined) ?? {}),

	uploadChunk: async (envelope) =>
		uploadStore.chunk(envelope.app, (envelope.args[0] as Record<string, unknown> | undefined) ?? {}),

	uploadCommit: async (envelope) =>
		uploadStore.commit(envelope.app, (envelope.args[0] as Record<string, unknown> | undefined) ?? {}),

	uploadAbort: async (envelope) => {
		await uploadStore.abort(
			envelope.app,
			(envelope.args[0] as Record<string, unknown> | undefined) ?? {},
		);
		return undefined;
	},
};

type UploadFileArg = { filename?: unknown; bytes?: unknown; mime?: unknown };

async function uploadFileHandler(envelope: Envelope): Promise<{
	url: string;
	hash: string;
	ext: string;
	size: number;
	mime: string;
}> {
	if (!vaultPath) {
		throw makeWorkerError("Unavailable", "storage worker has no active vault");
	}
	const arg = envelope.args[0] as UploadFileArg | undefined;
	if (!arg || typeof arg.filename !== "string" || arg.filename.length === 0) {
		throw makeWorkerError("Invalid", "storage.uploadFile requires { filename: string }");
	}
	const buffer = toBuffer(arg.bytes);
	if (!buffer) {
		throw makeWorkerError("Invalid", "storage.uploadFile requires { bytes: Uint8Array }");
	}
	if (buffer.byteLength === 0) {
		throw makeWorkerError("Invalid", "storage.uploadFile rejects empty payload");
	}
	if (buffer.byteLength > UPLOAD_MAX_BYTES) {
		throw makeWorkerError("Invalid", `storage.uploadFile payload exceeds ${UPLOAD_MAX_BYTES} bytes`);
	}
	const ext = extname(arg.filename).toLowerCase();
	if (!UPLOAD_ALLOWED_EXTS.has(ext)) {
		throw makeWorkerError("Invalid", `storage.uploadFile unsupported extension: ${ext}`);
	}
	if (!/^[A-Za-z0-9._-]+$/.test(envelope.app)) {
		throw makeWorkerError("Invalid", `unsafe appId for upload path: ${envelope.app}`);
	}
	const dir = join(vaultPath, "data", "apps", envelope.app, "files");
	await mkdir(dir, { recursive: true });
	const hash = createHash("sha256").update(buffer).digest("hex");
	const targetName = `${hash}${ext}`;
	const targetPath = join(dir, targetName);
	try {
		await stat(targetPath);
		// dedup — bytes already on disk under this hash, skip write
	} catch {
		const tmp = `${targetPath}.tmp`;
		await writeFile(tmp, buffer);
		try {
			await rename(tmp, targetPath);
		} catch (error) {
			await unlink(tmp).catch(() => undefined);
			throw error;
		}
	}
	const url = `brainstorm://app-file/${encodeURIComponent(envelope.app)}/${encodeURIComponent(targetName)}`;
	const mime = typeof arg.mime === "string" ? arg.mime : "";
	return { url, hash, ext, size: buffer.byteLength, mime };
}

function toBuffer(value: unknown): Buffer | null {
	if (value instanceof Uint8Array)
		return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
	if (value instanceof ArrayBuffer) return Buffer.from(value);
	// `structuredClone` over IPC sometimes preserves Uint8Array as a plain
	// object whose prototype is lost; cope with that by reconstructing.
	if (value && typeof value === "object" && "buffer" in (value as { buffer?: unknown })) {
		const v = value as { buffer?: unknown; byteOffset?: number; byteLength?: number };
		if (v.buffer instanceof ArrayBuffer) {
			return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
		}
	}
	return null;
}

function readKv(envelope: Envelope): { key: string; value?: unknown } {
	const arg = envelope.args[0] as { key?: unknown; value?: unknown } | undefined;
	if (!arg || typeof arg.key !== "string" || arg.key.length === 0) {
		throw makeWorkerError("Invalid", "storage method requires { key: string }");
	}
	if (arg.key.includes("..") || arg.key.includes("/") || arg.key.includes("\\")) {
		throw makeWorkerError("Invalid", "storage key must not contain path separators or `..`");
	}
	return { key: arg.key, value: arg.value };
}

async function loadAppStore(appId: string): Promise<Map<string, unknown>> {
	const cached = cache.get(appId);
	if (cached) return cached;
	if (!vaultPath) {
		throw makeWorkerError("Unavailable", "storage worker has no active vault — call setVault first");
	}
	const file = fileFor(appId);
	let parsed: Record<string, unknown> = {};
	try {
		const raw = await readFile(file, "utf8");
		const data = JSON.parse(raw) as unknown;
		if (data && typeof data === "object" && !Array.isArray(data)) {
			parsed = data as Record<string, unknown>;
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const map = new Map<string, unknown>(Object.entries(parsed));
	cache.set(appId, map);
	return map;
}

async function flushAppStore(appId: string, store: Map<string, unknown>): Promise<void> {
	if (!vaultPath) {
		throw makeWorkerError("Unavailable", "storage worker has no active vault");
	}
	const file = fileFor(appId);
	const dir = dirname(file);
	await mkdir(dir, { recursive: true });
	const obj: Record<string, unknown> = {};
	for (const [k, v] of store.entries()) obj[k] = v;
	const tmp = `${file}.tmp`;
	await writeFile(tmp, JSON.stringify(obj, null, 2), "utf8");
	try {
		await rename(tmp, file);
	} catch (error) {
		await unlink(tmp).catch(() => undefined);
		throw error;
	}
}

function fileFor(appId: string): string {
	if (!vaultPath) throw makeWorkerError("Unavailable", "vault not set");
	if (!/^[A-Za-z0-9._-]+$/.test(appId)) {
		throw makeWorkerError("Invalid", `unsafe appId for storage path: ${appId}`);
	}
	return join(vaultPath, "data", "apps", appId, "kv.json");
}

export async function handleStorageEnvelope(raw: unknown): Promise<EnvelopeReply> {
	const validation = validateEnvelope(raw);
	if (!validation.ok) {
		return makeErrorReply(messageIdOrFallback(raw), {
			kind: "Invalid",
			message: validation.reason,
		});
	}
	const envelope = validation.envelope;
	if (envelope.service !== "storage") {
		return makeErrorReply(envelope.msg, {
			kind: "Invalid",
			message: `wrong service routed to storage worker: ${envelope.service}`,
		});
	}
	const handler = handlers[envelope.method];
	if (!handler) {
		return makeErrorReply(envelope.msg, {
			kind: "Unavailable",
			message: `storage method not implemented: ${envelope.method}`,
			method: envelope.method,
		});
	}
	try {
		const value = await handler(envelope);
		return makeOkReply(envelope.msg, value);
	} catch (error) {
		return makeErrorReply(envelope.msg, errorPayload(error));
	}
}

function messageIdOrFallback(raw: unknown): string {
	if (raw && typeof raw === "object") {
		const m = (raw as { msg?: unknown }).msg;
		if (typeof m === "string" && m.length > 0 && m.length <= 128) return m;
	}
	return "unknown";
}

function errorPayload(error: unknown): { kind: string; message: string } {
	if (error instanceof Error) {
		return { kind: error.name || "Error", message: error.message };
	}
	return { kind: "Error", message: String(error) };
}

/** Test helper — flush the in-memory cache and unbind the vault. Called by
 *  unit tests between cases; not intended for production use.
 *
 *  Returns a Promise so callers can `await` the upload-store dispose —
 *  fire-and-forget left WriteStreams + Hash contexts + 5-min reaper
 *  setTimeouts alive across tests, ballooning the vitest worker's RSS. */
export async function _resetStorageWorker(): Promise<void> {
	await uploadStore.disposeAll();
	vaultPath = null;
	cache.clear();
}

/** Unwrap the `MessageEvent` that Electron's `parentPort` delivers to the
 *  child, then route to `handleStorageEnvelope`. Exported so the parent-port
 *  wiring is covered by unit tests — the inline `port.on('message', ...)`
 *  block is not directly reachable from Vitest. */
export function handleParentPortMessage(event: ParentPortMessage): Promise<EnvelopeReply> {
	return handleStorageEnvelope(event.data);
}

/**
 * Entry-point wiring for the utilityProcess. We only register the message
 * listener when `process.parentPort` is present — which is the case when run
 * via `utilityProcess.fork`. Importing this module in a Vitest test will
 * skip this block entirely (no parentPort), so handlers can be exercised
 * directly via `handleStorageEnvelope`.
 */
installWorkerProcessGuards("storage");
wireParentPort("storage", handleParentPortMessage, (process as ProcessWithParentPort).parentPort);
