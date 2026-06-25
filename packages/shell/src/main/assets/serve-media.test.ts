import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type MediaUnsealer, resolveMediaTarget, serveVaultMedia } from "./serve-media";
import { VaultMediaDomain, deriveMediaKey, openMedia, sealMedia } from "./vault-media-crypto";

describe("resolveMediaTarget", () => {
	const vault = "/v";
	it("resolves a plain filename under the domain dir", () => {
		const r = resolveMediaTarget(vault, VaultMediaDomain.Cover, "/abc.png");
		expect(r).toEqual({ target: join(vault, "covers", "abc.png"), relName: "abc.png" });
	});

	it("rejects a traversal attempt", () => {
		expect(resolveMediaTarget(vault, VaultMediaDomain.Icon, "/../../etc/passwd")).toEqual({
			status: 400,
		});
	});

	it("rejects an empty path", () => {
		expect(resolveMediaTarget(vault, VaultMediaDomain.Cover, "/")).toEqual({ status: 400 });
	});

	it("maps the wallpaper domain to its nested subdir", () => {
		const r = resolveMediaTarget(vault, VaultMediaDomain.Wallpaper, "/w.jpg");
		expect(r).toEqual({
			target: join(vault, "dashboard", "wallpapers", "w.jpg"),
			relName: "w.jpg",
		});
	});
});

describe("serveVaultMedia", () => {
	const key = deriveMediaKey(new Uint8Array(32).fill(5));
	const unsealer: MediaUnsealer = {
		openMedia: (domain, relName, blob) => openMedia(key, domain, relName, blob),
	};
	const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 8, 7]);
	let vault: string;

	beforeEach(async () => {
		vault = await mkdtemp(join(tmpdir(), "brainstorm-serve-media-"));
	});
	afterEach(async () => {
		await rm(vault, { recursive: true, force: true });
	});

	it("decrypts a sealed blob and serves it with the right mime", async () => {
		const dir = join(vault, VaultMediaDomain.Cover);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "a.png"), sealMedia(key, VaultMediaDomain.Cover, "a.png", png));

		const res = await serveVaultMedia(vault, VaultMediaDomain.Cover, "/a.png", unsealer);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/png");
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
	});

	it("404s a missing file", async () => {
		const res = await serveVaultMedia(vault, VaultMediaDomain.Cover, "/nope.png", unsealer);
		expect(res.status).toBe(404);
	});

	it("403s a traversal attempt", async () => {
		const res = await serveVaultMedia(vault, VaultMediaDomain.Cover, "/..%2f..%2fx", unsealer);
		expect([400, 403]).toContain(res.status);
	});

	it("500s a sealed blob it can't decrypt (wrong key), never leaking ciphertext", async () => {
		const dir = join(vault, VaultMediaDomain.Cover);
		await mkdir(dir, { recursive: true });
		const wrong = deriveMediaKey(new Uint8Array(32).fill(1));
		await writeFile(join(dir, "a.png"), sealMedia(wrong, VaultMediaDomain.Cover, "a.png", png));
		const res = await serveVaultMedia(vault, VaultMediaDomain.Cover, "/a.png", unsealer);
		expect(res.status).toBe(500);
	});
});
