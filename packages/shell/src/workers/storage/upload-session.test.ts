import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type IdleReapHandle,
	MAX_OUTSTANDING_PER_APP,
	UPLOAD_TMP_SUBDIR,
	type UploadStore,
	type UploadStoreOptions,
	createUploadStore,
} from "./upload-session";

// Each `it(...)` creates an UploadStore; every `begin()` arms a 5-minute
// idle-reap setTimeout whose closure pins the Session (WriteStream + Hash
// + the store's internal Maps) in the libuv timer heap, even with .unref().
// Across the file's ~25 tests that adds up to ~50–80 retained
// stream/hash/closure tuples per worker run — the dominant leak in the
// 22 GB vitest-worker RSS the test workload was producing. This wrapper +
// `afterEach` below guarantee every created store is disposed.
let activeStores: UploadStore[] = [];

function makeStore(options: UploadStoreOptions): UploadStore {
	const store = createUploadStore(options);
	activeStores.push(store);
	return store;
}

async function disposeActiveStores(): Promise<void> {
	const stores = activeStores;
	activeStores = [];
	await Promise.all(stores.map((s) => s.disposeAll()));
}

const APP = "io.brainstorm.notes";
const OTHER_APP = "io.brainstorm.tasks";

const FOUR_MIB = 4 * 1024 * 1024;

function rng(bytes: number, seed = 1): Buffer {
	const buf = Buffer.alloc(bytes);
	let x = seed >>> 0;
	for (let i = 0; i < bytes; i++) {
		x = (x * 1664525 + 1013904223) >>> 0;
		buf[i] = x & 0xff;
	}
	return buf;
}

function sha256Hex(buf: Buffer): string {
	return createHash("sha256").update(buf).digest("hex");
}

function filesDir(vault: string, app: string): string {
	return join(vault, "data", "apps", app, "files");
}

function tmpDir(vault: string, app: string): string {
	return join(filesDir(vault, app), UPLOAD_TMP_SUBDIR);
}

describe("upload-session — happy path", () => {
	let vault: string;
	beforeEach(async () => {
		vault = await mkdtemp(join(tmpdir(), "bs-upload-session-"));
	});
	afterEach(async () => {
		await disposeActiveStores();
		await rm(vault, { recursive: true, force: true });
	});

	it("streams chunks to a .tmp then atomic-renames into the content-addressed store", async () => {
		const store = makeStore({ vaultPath: () => vault });
		const payload = rng(FOUR_MIB, 7);
		const { uploadToken, chunkBytes } = await store.begin(APP, {
			name: "movie.mp4",
			mime: "video/mp4",
			totalBytes: payload.byteLength,
		});
		expect(chunkBytes).toBeGreaterThan(0);
		expect(uploadToken).toMatch(/^up_/);

		let seq = 0;
		for (let offset = 0; offset < payload.byteLength; offset += chunkBytes) {
			const end = Math.min(offset + chunkBytes, payload.byteLength);
			const slice = payload.subarray(offset, end);
			const reply = await store.chunk(APP, {
				uploadToken,
				seq,
				bytesBase64: slice.toString("base64"),
			});
			expect(reply.ok).toBe(true);
			expect(reply.receivedBytes).toBe(end);
			seq += 1;
		}

		const result = await store.commit(APP, { uploadToken });
		expect(result.hash).toBe(sha256Hex(payload));
		expect(result.ext).toBe(".mp4");
		expect(result.size).toBe(payload.byteLength);
		expect(result.mime).toBe("video/mp4");
		expect(result.url).toBe(`brainstorm://app-file/${APP}/${result.hash}.mp4`);

		const onDisk = await readFile(join(filesDir(vault, APP), `${result.hash}.mp4`));
		expect(onDisk.equals(payload)).toBe(true);

		// Tmp is gone after rename.
		expect(existsSync(join(tmpDir(vault, APP), uploadToken))).toBe(false);
		expect(store.size).toBe(0);
	});

	it("expectedHash is honoured", async () => {
		const store = makeStore({ vaultPath: () => vault });
		const payload = rng(1024, 11);
		const { uploadToken } = await store.begin(APP, { name: "img.png" });
		await store.chunk(APP, { uploadToken, seq: 0, bytesBase64: payload.toString("base64") });
		const r = await store.commit(APP, { uploadToken, expectedHash: sha256Hex(payload) });
		expect(r.hash).toBe(sha256Hex(payload));
	});

	it("dedupes against an existing content-addressed file (drops the .tmp)", async () => {
		const store = makeStore({ vaultPath: () => vault });
		const payload = rng(512, 4);
		const hash = sha256Hex(payload);
		// Pre-populate the store with the same hash, simulating an earlier
		// upload via the single-envelope path.
		await mkdir(filesDir(vault, APP), { recursive: true });
		await writeFile(join(filesDir(vault, APP), `${hash}.png`), payload);

		const { uploadToken } = await store.begin(APP, { name: "x.png" });
		await store.chunk(APP, { uploadToken, seq: 0, bytesBase64: payload.toString("base64") });
		const r = await store.commit(APP, { uploadToken });
		expect(r.hash).toBe(hash);

		// Canonical file is the pre-existing one; .tmp is cleaned up.
		expect(existsSync(join(tmpDir(vault, APP), uploadToken))).toBe(false);
	});
});

describe("upload-session — failure modes", () => {
	let vault: string;
	beforeEach(async () => {
		vault = await mkdtemp(join(tmpdir(), "bs-upload-session-"));
	});
	afterEach(async () => {
		await disposeActiveStores();
		await rm(vault, { recursive: true, force: true });
	});

	it("rejects an unsupported extension at begin", async () => {
		const store = makeStore({ vaultPath: () => vault });
		await expect(store.begin(APP, { name: "danger.exe" })).rejects.toMatchObject({
			name: "Invalid",
		});
	});

	it("rejects an unsafe appId path-traversal", async () => {
		const store = makeStore({ vaultPath: () => vault });
		await expect(store.begin("../sneaky", { name: "x.png" })).rejects.toMatchObject({
			name: "Invalid",
		});
	});

	it("rejects when no vault is bound", async () => {
		const store = makeStore({ vaultPath: () => null });
		await expect(store.begin(APP, { name: "x.png" })).rejects.toMatchObject({
			name: "Unavailable",
		});
	});

	it("fails closed on cross-app token reuse", async () => {
		const store = makeStore({ vaultPath: () => vault });
		const { uploadToken } = await store.begin(APP, { name: "x.png" });
		await expect(
			store.chunk(OTHER_APP, { uploadToken, seq: 0, bytesBase64: "" }),
		).rejects.toMatchObject({ name: "Invalid" });
		await expect(store.commit(OTHER_APP, { uploadToken })).rejects.toMatchObject({
			name: "Invalid",
		});
		// The legitimate owner can still operate.
		const payload = rng(8, 99);
		await store.chunk(APP, { uploadToken, seq: 0, bytesBase64: payload.toString("base64") });
	});

	it("rejects out-of-order seq", async () => {
		const store = makeStore({ vaultPath: () => vault });
		const { uploadToken } = await store.begin(APP, { name: "x.png" });
		await store.chunk(APP, { uploadToken, seq: 0, bytesBase64: rng(16, 1).toString("base64") });
		await expect(
			store.chunk(APP, { uploadToken, seq: 5, bytesBase64: rng(16, 2).toString("base64") }),
		).rejects.toMatchObject({ name: "Invalid" });
	});

	it("idempotent retry: last seq with identical bytes is a no-op", async () => {
		const store = makeStore({ vaultPath: () => vault });
		const { uploadToken } = await store.begin(APP, { name: "x.png" });
		const chunk0 = rng(32, 1);
		const a = await store.chunk(APP, {
			uploadToken,
			seq: 0,
			bytesBase64: chunk0.toString("base64"),
		});
		const b = await store.chunk(APP, {
			uploadToken,
			seq: 0,
			bytesBase64: chunk0.toString("base64"),
		});
		expect(b.receivedBytes).toBe(a.receivedBytes);
	});

	it("rejects retry of seq with DIFFERENT bytes", async () => {
		const store = makeStore({ vaultPath: () => vault });
		const { uploadToken } = await store.begin(APP, { name: "x.png" });
		await store.chunk(APP, { uploadToken, seq: 0, bytesBase64: rng(16, 1).toString("base64") });
		await expect(
			store.chunk(APP, { uploadToken, seq: 0, bytesBase64: rng(16, 9).toString("base64") }),
		).rejects.toMatchObject({ name: "Invalid" });
	});

	it("rejects bytes that overflow declared totalBytes", async () => {
		const store = makeStore({ vaultPath: () => vault });
		const { uploadToken } = await store.begin(APP, { name: "x.png", totalBytes: 10 });
		await expect(
			store.chunk(APP, { uploadToken, seq: 0, bytesBase64: rng(16, 1).toString("base64") }),
		).rejects.toMatchObject({ name: "Invalid" });
	});

	it("rejects commit when actual bytes < declared totalBytes", async () => {
		const store = makeStore({ vaultPath: () => vault });
		const { uploadToken } = await store.begin(APP, { name: "x.png", totalBytes: 100 });
		await store.chunk(APP, { uploadToken, seq: 0, bytesBase64: rng(16, 1).toString("base64") });
		await expect(store.commit(APP, { uploadToken })).rejects.toMatchObject({ name: "Invalid" });
		// Session is torn down on the rejected commit.
		expect(store.size).toBe(0);
	});

	it("rejects commit when zero bytes received", async () => {
		const store = makeStore({ vaultPath: () => vault });
		const { uploadToken } = await store.begin(APP, { name: "x.png" });
		await expect(store.commit(APP, { uploadToken })).rejects.toMatchObject({ name: "Invalid" });
		expect(store.size).toBe(0);
	});

	it("rejects expectedHash mismatch and deletes tmp", async () => {
		const store = makeStore({ vaultPath: () => vault });
		const payload = rng(64, 3);
		const { uploadToken } = await store.begin(APP, { name: "x.png" });
		await store.chunk(APP, {
			uploadToken,
			seq: 0,
			bytesBase64: payload.toString("base64"),
		});
		await expect(
			store.commit(APP, { uploadToken, expectedHash: "0".repeat(64) }),
		).rejects.toMatchObject({ name: "Invalid" });
		expect(existsSync(join(tmpDir(vault, APP), uploadToken))).toBe(false);
		expect(store.size).toBe(0);
	});

	it("a failed rename mid-commit unlinks tmp + untracks session (no pin)", async () => {
		// Regression for the leak-review must-fix: at commit start the idle
		// reaper is cancelled; if a downstream await throws (closeStream,
		// mkdir, rename), the session must STILL be released — otherwise
		// the session pins forever in `sessions` + counts against
		// MAX_OUTSTANDING_PER_APP, and the .tmp orphans on disk.
		const store = makeStore({ vaultPath: () => vault });
		const payload = rng(64, 21);
		const hash = sha256Hex(payload);
		// Pre-create the canonical target as a DIRECTORY so that
		// `rename(tmp, target)` throws (EISDIR / ENOTEMPTY / EEXIST depending
		// on platform). `stat(target).isFile()` returns false for a dir, so
		// we don't fall into the dedupe branch — we hit the rename throw.
		await mkdir(join(filesDir(vault, APP), `${hash}.png`), { recursive: true });

		const { uploadToken } = await store.begin(APP, { name: "x.png" });
		await store.chunk(APP, {
			uploadToken,
			seq: 0,
			bytesBase64: payload.toString("base64"),
		});
		await expect(store.commit(APP, { uploadToken })).rejects.toBeDefined();
		// The session must NOT pin: no count against MAX_OUTSTANDING, no
		// orphan tmp on disk.
		expect(store.size).toBe(0);
		expect(existsSync(join(tmpDir(vault, APP), uploadToken))).toBe(false);
		// And the app can immediately begin a new session — the failed
		// commit released its slot.
		const next = await store.begin(APP, { name: "y.png" });
		expect(next.uploadToken).toMatch(/^up_/);
	});

	it("caps concurrent open sessions per app", async () => {
		const store = makeStore({ vaultPath: () => vault });
		const tokens: string[] = [];
		for (let i = 0; i < MAX_OUTSTANDING_PER_APP; i++) {
			const r = await store.begin(APP, { name: `x${i}.png` });
			tokens.push(r.uploadToken);
		}
		await expect(store.begin(APP, { name: "overflow.png" })).rejects.toMatchObject({
			name: "Invalid",
		});
		// Other apps are not affected by one app's ceiling.
		await store.begin(OTHER_APP, { name: "y.png" });
	});
});

describe("upload-session — abort + GC", () => {
	let vault: string;
	beforeEach(async () => {
		vault = await mkdtemp(join(tmpdir(), "bs-upload-session-"));
	});
	afterEach(async () => {
		await disposeActiveStores();
		await rm(vault, { recursive: true, force: true });
	});

	it("abort deletes the tmp file and drops the session", async () => {
		const store = makeStore({ vaultPath: () => vault });
		const { uploadToken } = await store.begin(APP, { name: "x.png" });
		await store.chunk(APP, { uploadToken, seq: 0, bytesBase64: rng(8, 1).toString("base64") });
		expect(existsSync(join(tmpDir(vault, APP), uploadToken))).toBe(true);
		await store.abort(APP, { uploadToken });
		expect(existsSync(join(tmpDir(vault, APP), uploadToken))).toBe(false);
		expect(store.size).toBe(0);
	});

	it("abort is silent on unknown / cross-app token", async () => {
		const store = makeStore({ vaultPath: () => vault });
		await expect(store.abort(APP, { uploadToken: "up_does_not_exist" })).resolves.toBeUndefined();
		const { uploadToken } = await store.begin(APP, { name: "x.png" });
		await expect(store.abort(OTHER_APP, { uploadToken })).resolves.toBeUndefined();
		// Token is still alive.
		expect(store.size).toBe(1);
	});

	it("gcOrphans on first begin wipes leftover tmps from a previous crash", async () => {
		await mkdir(tmpDir(vault, APP), { recursive: true });
		await writeFile(join(tmpDir(vault, APP), "up_leftover_one"), "junk");
		await writeFile(join(tmpDir(vault, APP), "up_leftover_two"), "junk");

		const store = makeStore({ vaultPath: () => vault });
		await store.begin(APP, { name: "x.png" });

		expect(existsSync(join(tmpDir(vault, APP), "up_leftover_one"))).toBe(false);
		expect(existsSync(join(tmpDir(vault, APP), "up_leftover_two"))).toBe(false);
	});

	it("idle reaper tears down stale sessions and deletes their tmp", async () => {
		const handles: Array<{ cancel: () => void; fire: () => void }> = [];
		const noop = () => {};
		const fakeScheduler = (cb: () => void): IdleReapHandle => {
			const h = { cancel: noop, fire: cb };
			handles.push(h);
			return { cancel: h.cancel };
		};
		const store = makeStore({ vaultPath: () => vault, scheduleIdleReap: fakeScheduler });
		const { uploadToken } = await store.begin(APP, { name: "x.png" });
		await store.chunk(APP, {
			uploadToken,
			seq: 0,
			bytesBase64: rng(16, 1).toString("base64"),
		});
		expect(existsSync(join(tmpDir(vault, APP), uploadToken))).toBe(true);
		// Fire the latest pending reaper.
		const fireLast = handles.at(-1);
		fireLast?.fire();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(existsSync(join(tmpDir(vault, APP), uploadToken))).toBe(false);
		expect(store.size).toBe(0);
	});

	it("disposeAllForApp tears down everything for that app", async () => {
		const store = makeStore({ vaultPath: () => vault });
		const a = await store.begin(APP, { name: "a.png" });
		const b = await store.begin(APP, { name: "b.png" });
		const c = await store.begin(OTHER_APP, { name: "c.png" });
		const removed = await store.disposeAllForApp(APP);
		expect(removed).toBe(2);
		expect(existsSync(join(tmpDir(vault, APP), a.uploadToken))).toBe(false);
		expect(existsSync(join(tmpDir(vault, APP), b.uploadToken))).toBe(false);
		expect(existsSync(join(tmpDir(vault, OTHER_APP), c.uploadToken))).toBe(true);
		expect(store.size).toBe(1);
	});

	it("disposeAll tears down everything across all apps", async () => {
		const store = makeStore({ vaultPath: () => vault });
		await store.begin(APP, { name: "a.png" });
		await store.begin(OTHER_APP, { name: "b.png" });
		await store.disposeAll();
		expect(store.size).toBe(0);
	});
});
