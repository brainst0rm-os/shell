import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../../../packages/shell/src/main/apps/manifest";

const MANIFEST_PATH = join(__dirname, "..", "manifest.json");

function readManifest(): unknown {
	return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

describe("apps/graph/manifest.json", () => {
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
		expect(result.manifest.id).toBe("io.brainstorm.graph");
		expect(result.manifest.sdk).toBe("1");
	});

	it("registers Graph/v1 + GraphView/v1 as primary openers so intent.open routes here", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const openers = result.manifest.registrations?.openers ?? [];
		expect(
			openers.find((op) => op.entityType === "brainstorm/Graph/v1" && op.kind === "primary"),
		).toBeDefined();
		expect(
			openers.find((op) => op.entityType === "brainstorm/GraphView/v1" && op.kind === "primary"),
		).toBeDefined();
	});

	it("introduces Graph/v1 and GraphView/v1 with inline schemas (offline install)", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const types = result.manifest.registrations?.entityTypes ?? [];
		const graph = types.find((t) => t.id === "brainstorm/Graph/v1");
		const graphView = types.find((t) => t.id === "brainstorm/GraphView/v1");
		expect(graph).toBeDefined();
		expect(graph?.schemaUrl).toMatch(/^https?:\/\//);
		expect(graph?.schema).toBeDefined();
		expect(graphView).toBeDefined();
		expect(graphView?.schemaUrl).toMatch(/^https?:\/\//);
		expect(graphView?.schema).toBeDefined();
	});

	it("declares the embedded-graph BP block id under io.brainstorm.graph/", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const blocks = result.manifest.registrations?.blocks ?? [];
		const embed = blocks.find((b) => b.id === "io.brainstorm.graph/embedded-graph");
		expect(embed).toBeDefined();
	});

	it("maps the embedded-graph block to brainstorm/Graph/v1 so the host /embed picker selects it", () => {
		// `entityTypes` is what `services.blocks.forType()` reads — without it the
		// block is only reachable by an explicit blockId and the doc-embed picker
		// would fall back to the generic shell card (mirrors database embedded-list).
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const blocks = result.manifest.registrations?.blocks ?? [];
		const embed = blocks.find((b) => b.id === "io.brainstorm.graph/embedded-graph");
		expect(embed?.entityTypes).toContain("brainstorm/Graph/v1");
	});

	it("registers intent.open for both Graph types as primary", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const intents = result.manifest.registrations?.intents ?? [];
		const openGraph = intents.find(
			(i) => i.verb === "open" && i.entityType === "brainstorm/Graph/v1",
		);
		const openView = intents.find(
			(i) => i.verb === "open" && i.entityType === "brainstorm/GraphView/v1",
		);
		expect(openGraph?.priority).toBe("primary");
		expect(openView?.priority).toBe("primary");
	});

	it("declares the typed-broad capability surface needed for pattern compilation (entities.read:*)", () => {
		// Pattern compilation crosses entity types — narrow per-type capability
		// declarations are present *in addition to* the broad `entities.read:*`
		// so individual revokes from the Settings → Security grants panel land
		// somewhere even though pattern compile depends on the broad grant.
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		expect(result.manifest.capabilities).toContain("entities.read:*");
		expect(result.manifest.capabilities).toContain("entities.write:*");
		expect(result.manifest.capabilities).toContain("entities.read:brainstorm/Graph/v1");
		expect(result.manifest.capabilities).toContain(
			"blocks.provide:io.brainstorm.graph/embedded-graph",
		);
	});

	it("declares files.write (9.13.13b export-to-file)", () => {
		// 9.13.13b — `Save as JSON/DOT/GraphML/SVG/PNG` routes through
		// `services.files.requestSave` → `services.files.write`. The cap is
		// non-default; users grant at install / via Settings → Security and
		// can revoke without losing the (clipboard-based) "Copy as X" rows.
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		expect(result.manifest.capabilities).toContain("files.write");
	});
});
