/**
 * covers-handlers content-store + path-safety tests. Electron is mocked
 * (it doesn't run in Vitest); the SVG path needs no `nativeImage`, so it
 * exercises the security-relevant mechanics directly: content-addressed
 * filenames, dedup idempotency, the `covers:list` hash filter, and the
 * `covers:delete` filename allow-list (the path-traversal floor).
 */

import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, IpcHandler>();

vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, fn: IpcHandler) => {
			handlers.set(channel, fn);
		},
	},
	dialog: { showOpenDialog: vi.fn() },
	nativeImage: { createFromBuffer: vi.fn() },
}));

let vaultPath: string;
vi.mock("../vault/session", () => ({
	getActiveVaultSession: () => ({ vaultPath }),
}));

import { registerCoversHandlers, uploadBytes } from "./covers-handlers";

const SVG = Buffer.from(
	'<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>',
);
const SHA256_RE = /^[0-9a-f]{64}\.svg$/;

beforeEach(async () => {
	handlers.clear();
	vaultPath = await mkdtemp(join(tmpdir(), "bs-covers-"));
});

afterEach(async () => {
	await rm(vaultPath, { recursive: true, force: true });
});

describe("uploadBytes (content-addressed store)", () => {
	it("writes a sha256-named file and returns brainstorm://cover/ urls", async () => {
		const res = await uploadBytes(vaultPath, SVG, ".svg");
		expect(res.url).toMatch(/^brainstorm:\/\/cover\/[0-9a-f]{64}\.svg$/);
		expect(res.thumbUrl).toMatch(/^brainstorm:\/\/cover\/[0-9a-f]{64}\.thumb\.jpg$/);
		const files = await readdir(join(vaultPath, "covers"));
		expect(files.filter((f) => SHA256_RE.test(f))).toHaveLength(1);
		// SVG keeps its bytes verbatim and gets no rasterised thumbnail.
		const stored = files.find((f) => SHA256_RE.test(f));
		expect(stored).toBeDefined();
		expect(await readFile(join(vaultPath, "covers", stored as string))).toEqual(SVG);
		expect(files.some((f) => f.endsWith(".thumb.jpg"))).toBe(false);
	});

	it("dedups identical content to one file (idempotent)", async () => {
		const a = await uploadBytes(vaultPath, SVG, ".svg");
		const b = await uploadBytes(vaultPath, SVG, ".svg");
		expect(b.url).toBe(a.url);
		const files = await readdir(join(vaultPath, "covers"));
		expect(files.filter((f) => SHA256_RE.test(f))).toHaveLength(1);
	});
});

describe("covers:list / covers:delete (path safety)", () => {
	it("lists only sha256-named originals, skipping thumbs and junk", async () => {
		registerCoversHandlers({ getDashboard: () => null });
		const { url } = await uploadBytes(vaultPath, SVG, ".svg");
		await writeFile(join(vaultPath, "covers", "not-a-hash.png"), "x");
		const list = (await handlers.get("covers:list")?.(null)) as Array<{ url: string }>;
		expect(list).toHaveLength(1);
		expect(list[0]?.url).toBe(url);
	});

	it("rejects delete of a non-content-hash filename (traversal floor)", async () => {
		registerCoversHandlers({ getDashboard: () => null });
		const evil = (await handlers.get("covers:delete")?.(
			null,
			"brainstorm://cover/..%2f..%2fsecret.key",
		)) as boolean;
		expect(evil).toBe(false);
	});

	it("deletes a real uploaded cover and its thumbnail entry", async () => {
		registerCoversHandlers({ getDashboard: () => null });
		const { url } = await uploadBytes(vaultPath, SVG, ".svg");
		const ok = (await handlers.get("covers:delete")?.(null, url)) as boolean;
		expect(ok).toBe(true);
		const files = await readdir(join(vaultPath, "covers"));
		expect(files.filter((f) => SHA256_RE.test(f))).toHaveLength(0);
	});
});
