import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../../../packages/shell/src/main/apps/manifest";

const MANIFEST_PATH = join(__dirname, "..", "manifest.json");

function readManifest(): unknown {
	return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

describe("apps/books/manifest.json", () => {
	it("passes the shell's manifest validator", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) {
			throw new Error(`manifest invalid at ${result.path}: ${result.reason}`);
		}
		expect(result.ok).toBe(true);
	});

	it("declares the expected app id + sdk pin", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		expect(result.manifest.id).toBe("io.brainstorm.books");
		expect(result.manifest.sdk).toBe("1");
	});

	it("introduces Book/v1 and Highlight/v1 with inline schemas (offline install)", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const types = result.manifest.registrations?.entityTypes ?? [];
		const book = types.find((t) => t.id === "brainstorm/Book/v1");
		const highlight = types.find((t) => t.id === "brainstorm/Highlight/v1");
		expect(book).toBeDefined();
		expect(book?.schemaUrl).toMatch(/^https?:\/\//);
		expect(book?.schema).toBeDefined();
		expect(highlight).toBeDefined();
		expect(highlight?.schemaUrl).toMatch(/^https?:\/\//);
		expect(highlight?.schema).toBeDefined();
	});

	it("registers Book/v1 as a primary opener so intent.open routes here", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const openers = result.manifest.registrations?.openers ?? [];
		expect(
			openers.find((op) => op.entityType === "brainstorm/Book/v1" && op.kind === "primary"),
		).toBeDefined();
	});

	it("declares narrow per-type entity caps for Book + Highlight", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const caps = result.manifest.capabilities;
		expect(caps).toContain("entities.read:brainstorm/Book/v1");
		expect(caps).toContain("entities.write:brainstorm/Book/v1");
		expect(caps).toContain("entities.read:brainstorm/Highlight/v1");
		expect(caps).toContain("entities.write:brainstorm/Highlight/v1");
	});

	it("reads + writes File/v1 (PDF bytes resolution 9.21.5 + import 9.21.2)", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const caps = result.manifest.capabilities;
		expect(caps).toContain("entities.read:brainstorm/File/v1");
		expect(caps).toContain("entities.write:brainstorm/File/v1");
	});

	it("requests files.read for the import picker + asset-store upload (9.21.7)", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		expect(result.manifest.capabilities).toContain("files.read");
	});

	it("does not request broad entities.read:* / entities.write:* at scaffold", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const caps = result.manifest.capabilities;
		expect(caps).not.toContain("entities.read:*");
		expect(caps).not.toContain("entities.write:*");
	});
});
