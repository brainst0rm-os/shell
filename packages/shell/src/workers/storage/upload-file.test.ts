import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetStorageWorker, handleStorageEnvelope } from "./index";

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

describe("storage worker — uploadFile", () => {
	let vaultDir: string;

	beforeEach(async () => {
		await _resetStorageWorker();
		vaultDir = await mkdtemp(join(tmpdir(), "brainstorm-upload-"));
		const reply = await handleStorageEnvelope(baseEnvelope("setVault", [{ path: vaultDir }], SHELL));
		if (!reply.ok) throw new Error(`setVault failed: ${reply.error.message}`);
	});

	afterEach(async () => {
		await _resetStorageWorker();
		await rm(vaultDir, { recursive: true, force: true });
	});

	function pngBytes(seed = 1): Uint8Array {
		// 8-byte PNG signature + a payload byte so we don't dedup across tests
		const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed]);
		return sig;
	}

	it("writes the file under <vault>/data/apps/<appId>/files/<sha256>.<ext>", async () => {
		const reply = await handleStorageEnvelope(
			baseEnvelope("uploadFile", [{ filename: "test.png", bytes: pngBytes(1), mime: "image/png" }]),
		);
		expect(reply.ok).toBe(true);
		if (!reply.ok) return;
		const value = reply.value as {
			url: string;
			hash: string;
			ext: string;
			size: number;
			mime: string;
		};
		expect(value.ext).toBe(".png");
		expect(value.size).toBe(9);
		expect(value.mime).toBe("image/png");
		expect(value.hash).toMatch(/^[0-9a-f]{64}$/);
		expect(value.url).toBe(`brainstorm://app-file/${APP}/${value.hash}.png`);
		const onDisk = await readFile(join(vaultDir, "data", "apps", APP, "files", `${value.hash}.png`));
		expect(onDisk).toEqual(Buffer.from(pngBytes(1)));
	});

	it("dedups identical content to the same hash without re-writing", async () => {
		const a = await handleStorageEnvelope(
			baseEnvelope("uploadFile", [{ filename: "x.png", bytes: pngBytes(42) }]),
		);
		const b = await handleStorageEnvelope(
			baseEnvelope("uploadFile", [{ filename: "y.png", bytes: pngBytes(42) }]),
		);
		expect(a.ok).toBe(true);
		expect(b.ok).toBe(true);
		if (!a.ok || !b.ok) return;
		const va = a.value as { url: string; hash: string };
		const vb = b.value as { url: string; hash: string };
		expect(va.hash).toBe(vb.hash);
		expect(va.url).toBe(vb.url);
	});

	it("rejects an unsupported extension", async () => {
		const reply = await handleStorageEnvelope(
			baseEnvelope("uploadFile", [{ filename: "danger.exe", bytes: pngBytes(2) }]),
		);
		expect(reply.ok).toBe(false);
		if (!reply.ok) expect(reply.error.kind).toBe("Invalid");
	});

	it("rejects an empty payload", async () => {
		const reply = await handleStorageEnvelope(
			baseEnvelope("uploadFile", [{ filename: "empty.png", bytes: new Uint8Array(0) }]),
		);
		expect(reply.ok).toBe(false);
		if (!reply.ok) expect(reply.error.kind).toBe("Invalid");
	});

	it("rejects payloads above the 25 MiB cap", async () => {
		const big = new Uint8Array(25 * 1024 * 1024 + 1);
		const reply = await handleStorageEnvelope(
			baseEnvelope("uploadFile", [{ filename: "big.png", bytes: big }]),
		);
		expect(reply.ok).toBe(false);
		if (!reply.ok) expect(reply.error.kind).toBe("Invalid");
	});

	it("rejects a missing filename", async () => {
		const reply = await handleStorageEnvelope(baseEnvelope("uploadFile", [{ bytes: pngBytes(3) }]));
		expect(reply.ok).toBe(false);
		if (!reply.ok) expect(reply.error.kind).toBe("Invalid");
	});

	it("rejects missing bytes", async () => {
		const reply = await handleStorageEnvelope(baseEnvelope("uploadFile", [{ filename: "f.png" }]));
		expect(reply.ok).toBe(false);
		if (!reply.ok) expect(reply.error.kind).toBe("Invalid");
	});

	it("returns Unavailable when the vault hasn't been set", async () => {
		await _resetStorageWorker();
		const reply = await handleStorageEnvelope(
			baseEnvelope("uploadFile", [{ filename: "f.png", bytes: pngBytes(5) }]),
		);
		expect(reply.ok).toBe(false);
		if (!reply.ok) expect(reply.error.kind).toBe("Unavailable");
	});

	it("rejects unsafe app ids", async () => {
		const reply = await handleStorageEnvelope(
			baseEnvelope("uploadFile", [{ filename: "f.png", bytes: pngBytes(6) }], "../../escape"),
		);
		expect(reply.ok).toBe(false);
		if (!reply.ok) expect(reply.error.kind).toBe("Invalid");
	});
});
