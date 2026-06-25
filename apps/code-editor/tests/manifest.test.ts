import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../../../packages/shell/src/main/apps/manifest";

const MANIFEST_PATH = join(__dirname, "..", "manifest.json");

function readManifest(): unknown {
	return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

describe("apps/code-editor/manifest.json", () => {
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
		expect(result.manifest.id).toBe("io.brainstorm.code-editor");
		expect(result.manifest.sdk).toBe("1");
	});

	it("registers CodeFile/v1 as a primary opener so intent.open routes here", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const openers = result.manifest.registrations?.openers ?? [];
		expect(
			openers.find((op) => op.entityType === "brainstorm/CodeFile/v1" && op.kind === "primary"),
		).toBeDefined();
	});

	it("registers primary openers for the common source-code MIMEs", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const openers = result.manifest.registrations?.openers ?? [];
		const primaryMimes = openers
			.filter((op) => op.kind === "primary" && typeof op.mime === "string")
			.map((op) => op.mime);
		expect(primaryMimes).toContain("text/x-typescript");
		expect(primaryMimes).toContain("application/json");
		expect(primaryMimes).toContain("text/css");
		expect(primaryMimes).toContain("application/x-sh");
	});

	it("does NOT register text/plain as primary — keeps Notes as the primary text opener", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const openers = result.manifest.registrations?.openers ?? [];
		const primaryText = openers.find((op) => op.mime === "text/plain" && op.kind === "primary");
		expect(primaryText).toBeUndefined();
	});

	it("introduces CodeFile/v1 with an inline schema (offline install)", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const types = result.manifest.registrations?.entityTypes ?? [];
		const codeFile = types.find((t) => t.id === "brainstorm/CodeFile/v1");
		expect(codeFile).toBeDefined();
		expect(codeFile?.schemaUrl).toMatch(/^https?:\/\//);
		expect(codeFile?.schema).toBeDefined();
	});

	it("does not declare dev-repo.* capabilities (vault-resident only in v1)", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const caps = result.manifest.capabilities ?? [];
		expect(caps).not.toContain("dev-repo.read");
		expect(caps).not.toContain("dev-repo.write");
	});

	it("declares the open intent for CodeFile/v1", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const intents = result.manifest.registrations?.intents ?? [];
		const openIntent = intents.find(
			(i) => i.verb === "open" && i.entityType === "brainstorm/CodeFile/v1",
		);
		expect(openIntent).toBeDefined();
		expect(openIntent?.priority).toBe("primary");
	});
});
