import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../../../packages/shell/src/main/apps/manifest";

const MANIFEST_PATH = join(__dirname, "..", "manifest.json");

function readManifest(): unknown {
	return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

describe("apps/whiteboard/manifest.json", () => {
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
		expect(result.manifest.id).toBe("io.brainstorm.whiteboard");
		expect(result.manifest.sdk).toBe("1");
	});

	it("registers Whiteboard/v1 as the primary opener", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const openers = result.manifest.registrations?.openers ?? [];
		expect(
			openers.find((op) => op.entityType === "brainstorm/Whiteboard/v1" && op.kind === "primary"),
		).toBeDefined();
	});

	it("introduces Whiteboard/v1 + WhiteboardEdge/v1 with inline schemas (offline install)", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const types = result.manifest.registrations?.entityTypes ?? [];
		const wb = types.find((t) => t.id === "brainstorm/Whiteboard/v1");
		const edge = types.find((t) => t.id === "brainstorm/WhiteboardEdge/v1");
		expect(wb).toBeDefined();
		expect(wb?.schemaUrl).toMatch(/^https?:\/\//);
		expect(wb?.schema).toBeDefined();
		expect(edge).toBeDefined();
		expect(edge?.schemaUrl).toMatch(/^https?:\/\//);
		expect(edge?.schema).toBeDefined();
	});

	it("declares the embedded-whiteboard BP block id under io.brainstorm.whiteboard/", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const blocks = result.manifest.registrations?.blocks ?? [];
		const block = blocks.find((b) => b.id === "io.brainstorm.whiteboard/embedded-whiteboard");
		expect(block).toBeDefined();
	});

	it("registers open + compose + export intents on Whiteboard/v1 as primary", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const intents = result.manifest.registrations?.intents ?? [];
		const open = intents.find(
			(i) => i.verb === "open" && i.entityType === "brainstorm/Whiteboard/v1",
		);
		const compose = intents.find(
			(i) => i.verb === "compose" && i.entityType === "brainstorm/Whiteboard/v1",
		);
		const exportIntent = intents.find(
			(i) => i.verb === "export" && i.entityType === "brainstorm/Whiteboard/v1",
		);
		expect(open?.priority).toBe("primary");
		expect(compose?.priority).toBe("primary");
		expect(exportIntent?.priority).toBe("primary");
	});

	it("declares per-type narrow caps for both Whiteboard + WhiteboardEdge plus the embedded-whiteboard block.provide cap", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		expect(result.manifest.capabilities).toContain("entities.read:brainstorm/Whiteboard/v1");
		expect(result.manifest.capabilities).toContain("entities.write:brainstorm/Whiteboard/v1");
		expect(result.manifest.capabilities).toContain("entities.read:brainstorm/WhiteboardEdge/v1");
		expect(result.manifest.capabilities).toContain("entities.write:brainstorm/WhiteboardEdge/v1");
		expect(result.manifest.capabilities).toContain(
			"blocks.provide:io.brainstorm.whiteboard/embedded-whiteboard",
		);
	});

	it("declares files.write (9.17.8b export-to-file)", () => {
		// 9.17.8b — `Save as JSON/SVG/PNG` routes through
		// `services.files.requestSave` → `services.files.write`. The cap is
		// non-default; the clipboard-based "Copy as X" rows keep working
		// if the user revokes file-write at Settings → Security.
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		expect(result.manifest.capabilities).toContain("files.write");
	});

	it("declares files.read (9.17.11 image insertion)", () => {
		// 9.17.11 — `Add ▾ → Image…` routes through `services.files.requestOpen`
		// → `services.files.read`, inlining the bytes as a `data:` URL (CSP
		// forbids remote `img-src`). Non-default; the Image row hides when the
		// user revokes file-read at Settings → Security.
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		expect(result.manifest.capabilities).toContain("files.read");
	});
});
