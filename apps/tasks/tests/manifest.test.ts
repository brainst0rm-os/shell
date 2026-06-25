import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../../../packages/shell/src/main/apps/manifest";

const MANIFEST_PATH = join(__dirname, "..", "manifest.json");

function readManifest(): unknown {
	return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

describe("apps/tasks/manifest.json", () => {
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
		expect(result.manifest.id).toBe("io.brainstorm.tasks");
		expect(result.manifest.sdk).toBe("1");
	});

	it("registers Task/v1 + Project/v1 as primary openers so intent.open routes here", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const openers = result.manifest.registrations?.openers ?? [];
		expect(
			openers.find((op) => op.entityType === "brainstorm/Task/v1" && op.kind === "primary"),
		).toBeDefined();
		expect(
			openers.find((op) => op.entityType === "brainstorm/Project/v1" && op.kind === "primary"),
		).toBeDefined();
	});

	it("introduces Task/v1 + Project/v1 with inline schemas (offline install)", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const types = result.manifest.registrations?.entityTypes ?? [];
		const task = types.find((t) => t.id === "brainstorm/Task/v1");
		const project = types.find((t) => t.id === "brainstorm/Project/v1");
		expect(task).toBeDefined();
		expect(task?.schemaUrl).toMatch(/^https?:\/\//);
		expect(task?.schema).toBeDefined();
		expect(project).toBeDefined();
		expect(project?.schemaUrl).toMatch(/^https?:\/\//);
		expect(project?.schema).toBeDefined();
	});

	it("declares the inline-task BP block id under io.brainstorm.tasks/", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const blocks = result.manifest.registrations?.blocks ?? [];
		const block = blocks.find((b) => b.id === "io.brainstorm.tasks/inline-task");
		expect(block).toBeDefined();
	});

	it("registers open + compose + quick-look intents on Task/v1 as primary", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const intents = result.manifest.registrations?.intents ?? [];
		const open = intents.find((i) => i.verb === "open" && i.entityType === "brainstorm/Task/v1");
		const compose = intents.find(
			(i) => i.verb === "compose" && i.entityType === "brainstorm/Task/v1",
		);
		const quickLook = intents.find(
			(i) => i.verb === "quick-look" && i.entityType === "brainstorm/Task/v1",
		);
		expect(open?.priority).toBe("primary");
		expect(compose?.priority).toBe("primary");
		expect(quickLook?.priority).toBe("primary");
	});

	it("declares the per-type narrow caps + the inline-task block.provide cap", () => {
		// Narrow per-type capability declarations sit alongside the broad
		// `entities.read:*` so individual revokes from Settings → Security
		// still land somewhere even after the broad grant lands.
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		expect(result.manifest.capabilities).toContain("entities.read:brainstorm/Task/v1");
		expect(result.manifest.capabilities).toContain("entities.write:brainstorm/Task/v1");
		expect(result.manifest.capabilities).toContain("entities.read:brainstorm/Project/v1");
		expect(result.manifest.capabilities).toContain("entities.write:brainstorm/Project/v1");
		expect(result.manifest.capabilities).toContain("blocks.provide:io.brainstorm.tasks/inline-task");
		expect(result.manifest.capabilities).toContain("properties.read");
		expect(result.manifest.capabilities).toContain("properties.write");
	});
});
