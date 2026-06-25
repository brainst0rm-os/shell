import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../../../packages/shell/src/main/apps/manifest";

const MANIFEST_PATH = join(__dirname, "..", "manifest.json");

function readManifest(): unknown {
	return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

describe("apps/theme-editor/manifest.json", () => {
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
		expect(result.manifest.id).toBe("io.brainstorm.theme-editor");
		expect(result.manifest.sdk).toBe("1");
	});

	it("registers Theme/v1 as the primary opener", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const openers = result.manifest.registrations?.openers ?? [];
		expect(
			openers.find((op) => op.entityType === "brainstorm/Theme/v1" && op.kind === "primary"),
		).toBeDefined();
	});

	it("introduces every component type it writes with inline schemas (offline install)", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const types = result.manifest.registrations?.entityTypes ?? [];
		for (const id of [
			"brainstorm/Theme/v1",
			"brainstorm/TokenSet/v1",
			"brainstorm/StylePack/v1",
			"brainstorm/Typography/v1",
		]) {
			const type = types.find((t) => t.id === id);
			expect(type, id).toBeDefined();
			expect(type?.schemaUrl).toMatch(/^https?:\/\//);
			expect(type?.schema).toBeDefined();
		}
	});

	it("caps a write for every component entity the save path persists (F-240)", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const caps = result.manifest.capabilities;
		for (const type of [
			"brainstorm/Theme/v1",
			"brainstorm/TokenSet/v1",
			"brainstorm/StylePack/v1",
			"brainstorm/Typography/v1",
		]) {
			expect(caps, type).toContain(`entities.write:${type}`);
		}
	});

	it("registers the open intent on Theme/v1 as primary", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const intents = result.manifest.registrations?.intents ?? [];
		const open = intents.find((i) => i.verb === "open" && i.entityType === "brainstorm/Theme/v1");
		expect(open?.priority).toBe("primary");
	});

	it("declares the narrow per-type caps + read:* for component enumeration", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const caps = result.manifest.capabilities;
		expect(caps).toContain("entities.read:brainstorm/Theme/v1");
		expect(caps).toContain("entities.write:brainstorm/Theme/v1");
		expect(caps).toContain("entities.read:brainstorm/TokenSet/v1");
		expect(caps).toContain("entities.write:brainstorm/TokenSet/v1");
		expect(caps).toContain("entities.read:*");
	});

	it("requests no network, files, or block-provide surface (themes are passive)", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const caps = result.manifest.capabilities;
		expect(caps.some((c) => c.startsWith("network."))).toBe(false);
		expect(caps.some((c) => c.startsWith("files."))).toBe(false);
		expect(caps.some((c) => c.startsWith("blocks.provide"))).toBe(false);
	});
});
