import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CatalogFileCache, catalogCachePath } from "./catalog-file-cache";
import type { CatalogIndex } from "./catalog-wire-types";

function sampleIndex(): CatalogIndex {
	return {
		catalogId: "brainstorm-official",
		generatedAt: 1_700_000_000,
		ttlSeconds: 3600,
		listings: [
			{
				id: "io.brainstorm.notes",
				kind: "app",
				publisherKey: "ed25519:dev",
				name: "Notes",
				channels: { stable: "1.5.0" },
				versions: {
					"1.5.0": {
						manifestUrl: "https://cdn.test/notes/manifest.json",
						bundleUrl: "https://cdn.test/notes/io.brainstorm.notes-1.5.0.brainstorm",
						sha256: "a".repeat(64),
						signature: "sig",
						sdk: "1",
						minShell: "1.0.0",
					},
				},
				firstParty: true,
			},
		],
	};
}

describe("CatalogFileCache", () => {
	let dir: string;
	let path: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "bs-catalog-cache-"));
		path = catalogCachePath(dir);
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("starts empty", () => {
		expect(new CatalogFileCache({ path }).load()).toBeNull();
	});

	it("persists across instances (survives a restart)", () => {
		new CatalogFileCache({ path }).save(sampleIndex());
		const reopened = new CatalogFileCache({ path }).load();
		expect(reopened?.listings[0]?.id).toBe("io.brainstorm.notes");
		expect(reopened).toEqual(sampleIndex());
	});

	it("returns the saved index without re-reading the file", () => {
		const cache = new CatalogFileCache({ path });
		cache.save(sampleIndex());
		expect(cache.load()).toEqual(sampleIndex());
	});

	it("reads a corrupt or schema-invalid file as no cache (default-on-corrupt)", () => {
		writeFileSync(path, "{ not json", "utf8");
		expect(new CatalogFileCache({ path }).load()).toBeNull();
		writeFileSync(path, JSON.stringify({ catalogId: "c" }), "utf8");
		expect(new CatalogFileCache({ path }).load()).toBeNull();
	});
});
