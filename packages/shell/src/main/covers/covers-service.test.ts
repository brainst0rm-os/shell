/**
 * `covers` broker service handler — method routing, arg validation, and
 * the capability-relevant failure modes. Electron is mocked (no Vitest
 * runtime); the SVG path needs no `nativeImage`, so this drives the real
 * shared store core through a tmp vault. The broker itself enforces
 * `covers.read`/`covers.write` from the envelope `caps`; these tests pin
 * the handler contract the broker hands off to.
 */

import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	ipcMain: { handle: () => {} },
	dialog: { showOpenDialog: vi.fn() },
	nativeImage: { createFromBuffer: vi.fn() },
}));
vi.mock("../vault/session", () => ({ getActiveVaultSession: () => null }));

import type { Envelope } from "../../ipc/envelope";
import { makeCoversServiceHandler } from "./covers-service";

const SVG = Buffer.from(
	'<svg xmlns="http://www.w3.org/2000/svg"><rect width="2" height="2"/></svg>',
);

function env(method: string, args: unknown[]): Envelope {
	return { v: 1, msg: "m1", app: "io.test.app", service: "covers", method, args, caps: [] };
}

let vaultPath: string;
const handler = makeCoversServiceHandler({ getVaultPath: () => vaultPath });

beforeEach(async () => {
	vaultPath = await mkdtemp(join(tmpdir(), "bs-covsvc-"));
});
afterEach(async () => {
	await rm(vaultPath, { recursive: true, force: true });
});

describe("covers service handler", () => {
	it("uploadBytes stores content-addressed and round-trips through list", async () => {
		const res = (await handler(
			env("uploadBytes", [{ name: "banner.svg", bytesBase64: SVG.toString("base64") }]),
		)) as { url: string; thumbUrl: string };
		expect(res.url).toMatch(/^brainstorm:\/\/cover\/[0-9a-f]{64}\.svg$/);

		const list = (await handler(env("list", []))) as Array<{ url: string }>;
		expect(list).toHaveLength(1);
		expect(list[0]?.url).toBe(res.url);

		const deleted = (await handler(env("delete", [{ url: res.url }]))) as boolean;
		expect(deleted).toBe(true);
		const after = (await handler(env("list", []))) as unknown[];
		expect(after).toHaveLength(0);
	});

	it("rejects an unsupported extension as Invalid", async () => {
		await expect(
			handler(env("uploadBytes", [{ name: "evil.exe", bytesBase64: SVG.toString("base64") }])),
		).rejects.toMatchObject({ name: "Invalid" });
		// nothing written
		await expect(readdir(join(vaultPath, "covers"))).rejects.toBeTruthy();
	});

	it("rejects an over-ceiling payload as Invalid", async () => {
		const huge = Buffer.alloc(26 * 1024 * 1024, 1); // > MAX_COVER_BYTES (25 MiB)
		await expect(
			handler(env("uploadBytes", [{ name: "big.png", bytesBase64: huge.toString("base64") }])),
		).rejects.toMatchObject({ name: "Invalid" });
	});

	it("rejects malformed args and unknown methods as Invalid", async () => {
		await expect(handler(env("uploadBytes", [{ name: "x.svg" }]))).rejects.toMatchObject({
			name: "Invalid",
		});
		await expect(handler(env("delete", [{}]))).rejects.toMatchObject({ name: "Invalid" });
		await expect(handler(env("frobnicate", []))).rejects.toMatchObject({ name: "Invalid" });
	});

	it("maps no-vault-session to Unavailable", async () => {
		const noVault = makeCoversServiceHandler({ getVaultPath: () => null });
		await expect(noVault(env("list", []))).rejects.toMatchObject({ name: "Unavailable" });
	});

	it("delete refuses a non-content-hash url (traversal floor)", async () => {
		const ok = (await handler(
			env("delete", [{ url: "brainstorm://cover/..%2f..%2fsecret" }]),
		)) as boolean;
		expect(ok).toBe(false);
	});
});
