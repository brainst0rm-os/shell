import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetStorageWorker, handleParentPortMessage, handleStorageEnvelope } from "./index";

const SHELL = "_shell";
const APP = "io.brainstorm.notes";

const baseEnvelope = (
	method: string,
	args: unknown[] = [],
	app: string = APP,
): Record<string, unknown> => ({
	v: 1,
	msg: `m-${Math.random().toString(36).slice(2, 10)}`,
	app,
	service: "storage",
	method,
	args,
	caps: [],
});

describe("storage worker — kv methods", () => {
	let vaultDir: string;

	beforeEach(async () => {
		await _resetStorageWorker();
		vaultDir = await mkdtemp(join(tmpdir(), "brainstorm-storage-"));
		const reply = await handleStorageEnvelope(baseEnvelope("setVault", [{ path: vaultDir }], SHELL));
		if (!reply.ok) throw new Error(`setVault failed: ${reply.error.message}`);
	});

	afterEach(async () => {
		await _resetStorageWorker();
		await rm(vaultDir, { recursive: true, force: true });
	});

	it("rejects setVault when not invoked with the shell sentinel", async () => {
		const reply = await handleStorageEnvelope(
			baseEnvelope("setVault", [{ path: vaultDir }], "io.malicious.app"),
		);
		expect(reply.ok).toBe(false);
		if (!reply.ok) expect(reply.error.kind).toBe("Invalid");
	});

	it("put then get round-trips an arbitrary JSON value", async () => {
		const put = await handleStorageEnvelope(
			baseEnvelope("put", [{ key: "note:1", value: { id: "1", title: "Hello" } }]),
		);
		expect(put.ok).toBe(true);
		const get = await handleStorageEnvelope(baseEnvelope("get", [{ key: "note:1" }]));
		expect(get.ok).toBe(true);
		if (get.ok) expect(get.value).toEqual({ id: "1", title: "Hello" });
	});

	it("get returns null for an unknown key", async () => {
		const reply = await handleStorageEnvelope(baseEnvelope("get", [{ key: "missing" }]));
		expect(reply.ok).toBe(true);
		if (reply.ok) expect(reply.value).toBe(null);
	});

	it("list returns only keys with the given prefix", async () => {
		await handleStorageEnvelope(baseEnvelope("put", [{ key: "note:a", value: 1 }]));
		await handleStorageEnvelope(baseEnvelope("put", [{ key: "note:b", value: 2 }]));
		await handleStorageEnvelope(baseEnvelope("put", [{ key: "draft:x", value: 9 }]));
		const reply = await handleStorageEnvelope(baseEnvelope("list", [{ prefix: "note:" }]));
		expect(reply.ok).toBe(true);
		if (reply.ok) {
			const value = reply.value as Array<{ key: string; value: unknown }>;
			expect(value.map((v) => v.key).sort()).toEqual(["note:a", "note:b"]);
		}
	});

	it("delete removes a key and returns whether it existed", async () => {
		await handleStorageEnvelope(baseEnvelope("put", [{ key: "note:x", value: 1 }]));
		const first = await handleStorageEnvelope(baseEnvelope("delete", [{ key: "note:x" }]));
		const second = await handleStorageEnvelope(baseEnvelope("delete", [{ key: "note:x" }]));
		expect(first.ok && first.value).toBe(true);
		expect(second.ok && second.value).toBe(false);
	});

	it("apps are isolated — one app cannot read another app's keys", async () => {
		await handleStorageEnvelope(baseEnvelope("put", [{ key: "secret", value: "alpha" }], "io.app.a"));
		const reply = await handleStorageEnvelope(baseEnvelope("get", [{ key: "secret" }], "io.app.b"));
		expect(reply.ok).toBe(true);
		if (reply.ok) expect(reply.value).toBe(null);
	});

	it("rejects keys that try to escape the per-app dir", async () => {
		const reply = await handleStorageEnvelope(
			baseEnvelope("put", [{ key: "../escape", value: "nope" }]),
		);
		expect(reply.ok).toBe(false);
		if (!reply.ok) expect(reply.error.kind).toBe("Invalid");
	});

	it("persists across worker restarts (file on disk)", async () => {
		await handleStorageEnvelope(baseEnvelope("put", [{ key: "k", value: { ok: true } }]));
		// Read the file directly — simulates a restart by checking on-disk state.
		const file = join(vaultDir, "data", "apps", APP, "kv.json");
		const raw = await readFile(file, "utf8");
		expect(JSON.parse(raw)).toEqual({ k: { ok: true } });

		// Now actually restart the worker and read back via get.
		await _resetStorageWorker();
		const setVault = await handleStorageEnvelope(
			baseEnvelope("setVault", [{ path: vaultDir }], SHELL),
		);
		expect(setVault.ok).toBe(true);
		const get = await handleStorageEnvelope(baseEnvelope("get", [{ key: "k" }]));
		expect(get.ok && get.value).toEqual({ ok: true });
	});

	it("returns Unavailable when called before setVault", async () => {
		await _resetStorageWorker();
		const reply = await handleStorageEnvelope(baseEnvelope("get", [{ key: "anything" }]));
		expect(reply.ok).toBe(false);
		if (!reply.ok) expect(reply.error.kind).toBe("Unavailable");
	});

	// Electron's `process.parentPort` delivers a MessageEvent (`{ data, ports }`)
	// to the child's 'message' listener — not the raw posted value. If the
	// worker forgets to unwrap `.data`, the envelope validator fails and the
	// reply's `msg` falls back to "unknown", which the parent's WorkerBridge
	// cannot correlate to its pending request — the call hangs until timeout.
	// Regression for the `set-vault` timeout seen in Stage 3 dev runs.
	it("handleParentPortMessage unwraps the MessageEvent .data field", async () => {
		const envelope = baseEnvelope("setVault", [{ path: vaultDir }], SHELL);
		const reply = await handleParentPortMessage({ data: envelope });
		expect(reply.ok).toBe(true);
		expect(reply.msg).toBe(envelope.msg);
	});
});
