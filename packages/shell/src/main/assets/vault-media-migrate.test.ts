import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VaultMediaDomain, deriveMediaKey, isSealedMedia, openMedia } from "./vault-media-crypto";
import { migrateMediaDir } from "./vault-media-migrate";

const key = deriveMediaKey(new Uint8Array(32).fill(3));
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

let vault: string;
beforeEach(async () => {
	vault = await mkdtemp(join(tmpdir(), "brainstorm-media-mig-"));
});
afterEach(async () => {
	await rm(vault, { recursive: true, force: true });
});

describe("migrateMediaDir", () => {
	it("seals plaintext files in place and leaves them openable", async () => {
		const dir = join(vault, VaultMediaDomain.Cover);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "a.png"), png);
		await writeFile(join(dir, "b.png"), png);

		const sealed = await migrateMediaDir(vault, VaultMediaDomain.Cover, key);
		expect(sealed).toBe(2);

		const onDisk = await readFile(join(dir, "a.png"));
		expect(isSealedMedia(onDisk)).toBe(true);
		expect(openMedia(key, VaultMediaDomain.Cover, "a.png", onDisk)).toEqual(new Uint8Array(png));
	});

	it("is idempotent — a second run seals nothing", async () => {
		const dir = join(vault, VaultMediaDomain.Icon);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "x.png"), png);
		expect(await migrateMediaDir(vault, VaultMediaDomain.Icon, key)).toBe(1);
		expect(await migrateMediaDir(vault, VaultMediaDomain.Icon, key)).toBe(0);
	});

	it("returns 0 for a missing domain dir", async () => {
		expect(await migrateMediaDir(vault, VaultMediaDomain.Wallpaper, key)).toBe(0);
	});

	it("skips leftover temp files", async () => {
		const dir = join(vault, VaultMediaDomain.Cover);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "a.png.reseal-tmp"), png);
		await writeFile(join(dir, "a.png"), png);
		expect(await migrateMediaDir(vault, VaultMediaDomain.Cover, key)).toBe(1);
	});
});
