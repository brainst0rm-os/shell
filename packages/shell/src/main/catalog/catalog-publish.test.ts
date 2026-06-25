import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unpackBrainstormBundle, verifyBundleSignature } from "./brainstorm-package";
import { buildPublishedBundle, publisherKeyForSeed, readAppBundleFiles } from "./catalog-publish";

const SEED = new Uint8Array(32).map((_, i) => (i + 7) & 0xff);

async function writeBuiltApp(dir: string): Promise<void> {
	await mkdir(join(dir, "dist", "blocks"), { recursive: true });
	await mkdir(join(dir, "assets"), { recursive: true });
	await writeFile(join(dir, "manifest.json"), '{"id":"io.example.app","version":"1.2.0"}');
	await writeFile(join(dir, "icon.svg"), "<svg/>");
	await writeFile(join(dir, "dist", "index.html"), "<!doctype html>");
	await writeFile(join(dir, "dist", "blocks", "b.js"), "export const x=1");
	await writeFile(join(dir, "assets", "logo.png"), "PNGDATA");
}

describe("readAppBundleFiles", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "bs-pub-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("collects manifest + icon + every dist/assets file with posix paths", async () => {
		await writeBuiltApp(dir);
		const files = await readAppBundleFiles(dir);
		expect([...files.keys()].sort()).toEqual([
			"assets/logo.png",
			"dist/blocks/b.js",
			"dist/index.html",
			"icon.svg",
			"manifest.json",
		]);
	});

	it("throws on an unbuilt bundle (no dist/)", async () => {
		await writeFile(join(dir, "manifest.json"), "{}");
		await expect(readAppBundleFiles(dir)).rejects.toThrow(/not a built bundle/);
	});
});

describe("buildPublishedBundle", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "bs-pub-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("produces a signed bundle that unpacks + verifies against the publisher key", async () => {
		await writeBuiltApp(dir);
		const files = await readAppBundleFiles(dir);
		const published = buildPublishedBundle(files, SEED);

		// The bytes unpack back to the same files.
		const out = unpackBrainstormBundle(published.bytes);
		expect(new TextDecoder().decode(out.get("manifest.json"))).toContain("io.example.app");
		expect(out.has("dist/blocks/b.js")).toBe(true);

		// The signature verifies against the seed's published key (and not another).
		const publisherKey = publisherKeyForSeed(SEED);
		expect(verifyBundleSignature(published.sha256, published.signature, publisherKey)).toBe(true);
		const otherKey = publisherKeyForSeed(new Uint8Array(32).fill(2));
		expect(verifyBundleSignature(published.sha256, published.signature, otherKey)).toBe(false);
	});

	it("is deterministic — same files → same sha256", async () => {
		await writeBuiltApp(dir);
		const files = await readAppBundleFiles(dir);
		expect(buildPublishedBundle(files, SEED).sha256).toBe(buildPublishedBundle(files, SEED).sha256);
	});
});
