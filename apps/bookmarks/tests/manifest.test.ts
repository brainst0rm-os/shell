import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../../../packages/shell/src/main/apps/manifest";

const MANIFEST_PATH = join(__dirname, "..", "manifest.json");

function readManifest(): unknown {
	return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

describe("apps/bookmarks/manifest.json", () => {
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
		expect(result.manifest.id).toBe("io.brainstorm.bookmarks");
		expect(result.manifest.sdk).toBe("1");
	});

	it("registers Bookmark/v1 as the primary opener", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const openers = result.manifest.registrations?.openers ?? [];
		expect(
			openers.find((op) => op.entityType === "brainstorm/Bookmark/v1" && op.kind === "primary"),
		).toBeDefined();
	});

	it("introduces Bookmark/v1 with an inline schema (offline install)", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const types = result.manifest.registrations?.entityTypes ?? [];
		const bookmark = types.find((t) => t.id === "brainstorm/Bookmark/v1");
		expect(bookmark).toBeDefined();
		expect(bookmark?.schemaUrl).toMatch(/^https?:\/\//);
		expect(bookmark?.schema).toBeDefined();
	});

	it("declares the `bookmark` BP block id under io.brainstorm.bookmarks/", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const blocks = result.manifest.registrations?.blocks ?? [];
		const block = blocks.find((b) => b.id === "io.brainstorm.bookmarks/bookmark");
		expect(block).toBeDefined();
	});

	it("registers open + compose + quick-look intents on Bookmark/v1 as primary", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const intents = result.manifest.registrations?.intents ?? [];
		const open = intents.find((i) => i.verb === "open" && i.entityType === "brainstorm/Bookmark/v1");
		const compose = intents.find(
			(i) => i.verb === "compose" && i.entityType === "brainstorm/Bookmark/v1",
		);
		const quickLook = intents.find(
			(i) => i.verb === "quick-look" && i.entityType === "brainstorm/Bookmark/v1",
		);
		expect(open?.priority).toBe("primary");
		expect(compose?.priority).toBe("primary");
		expect(quickLook?.priority).toBe("primary");
	});

	it("declares the per-type narrow caps + the bookmark block.provide cap", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		expect(result.manifest.capabilities).toContain("entities.read:brainstorm/Bookmark/v1");
		expect(result.manifest.capabilities).toContain("entities.write:brainstorm/Bookmark/v1");
		expect(result.manifest.capabilities).toContain("blocks.provide:io.brainstorm.bookmarks/bookmark");
		expect(result.manifest.capabilities).toContain("properties.read");
		expect(result.manifest.capabilities).toContain("properties.write");
	});

	it("requests `network.preview` + `network.readable` (scrape + offline content) and nothing wider", () => {
		// favicon/cover scrape needs `network.preview`; capturing the page body
		// for the detail view needs `network.readable`. Neither `network.fetch`
		// nor `.private` is requested — the app never pulls arbitrary bytes or
		// reaches private hosts.
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		expect(result.manifest.capabilities).toContain("network.preview");
		expect(result.manifest.capabilities).toContain("network.readable");
		expect(result.manifest.capabilities).not.toContain("network.fetch");
		expect(result.manifest.capabilities).not.toContain("network.fetch.private");
		expect(result.manifest.capabilities).not.toContain("network.readable.private");
	});
});
