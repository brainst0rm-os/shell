import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../../../packages/shell/src/main/apps/manifest";

const MANIFEST_PATH = join(__dirname, "..", "manifest.json");

function readManifest(): unknown {
	return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

describe("apps/files/manifest.json", () => {
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
		expect(result.manifest.id).toBe("io.brainstorm.files");
		expect(result.manifest.sdk).toBe("1");
	});

	it("registers Folder/v1 as primary opener so intent.open routes here", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const openers = result.manifest.registrations?.openers ?? [];
		const folderOpener = openers.find(
			(op) => op.entityType === "brainstorm/Folder/v1" && op.kind === "primary",
		);
		expect(folderOpener).toBeDefined();
	});

	it("introduces brainstorm/Folder/v1 with an inline schema (offline-install)", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const types = result.manifest.registrations?.entityTypes ?? [];
		const folder = types.find((t) => t.id === "brainstorm/Folder/v1");
		expect(folder).toBeDefined();
		expect(folder?.schemaUrl).toMatch(/^https?:\/\//);
		expect(folder?.schema).toBeDefined();
	});

	it("declares the files.read capability so 9.8.5 upload can pick OS files", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		expect(result.manifest.capabilities).toContain("files.read");
	});

	it("declares search.open so the 9.8.9 scope chip can flip to the launcher", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		expect(result.manifest.capabilities).toContain("search.open");
	});
});
