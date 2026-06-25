import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../../../packages/shell/src/main/apps/manifest";
import { REGISTERED_MIMES, previewKindFor } from "../src/logic/preview-kind-for";

const MANIFEST_PATH = join(__dirname, "..", "manifest.json");

function readManifest(): unknown {
	return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

describe("apps/preview/manifest.json", () => {
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
		expect(result.manifest.id).toBe("io.brainstorm.preview");
		expect(result.manifest.sdk).toBe("1");
	});

	it("registers intent.open as SECONDARY on every preview-able MIME except application/pdf — type-specific primary openers (Notes / Code-editor) still win, but Preview owns the ephemeral PDF open (F-257) so a plain open previews instead of minting a Book", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const intents = result.manifest.registrations?.intents ?? [];
		const opens = intents.filter((i) => i.verb === "open");
		expect(opens.length).toBeGreaterThan(0);
		for (const open of opens) {
			expect(open.mime).toBeDefined();
			const expected = open.mime === "application/pdf" ? "primary" : "secondary";
			expect(open.priority, `open ${open.mime} should be ${expected}`).toBe(expected);
		}
	});

	it("registers intent.quick-look as PRIMARY on every preview-able MIME — Files' Space-bar shortcut anchors here", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const intents = result.manifest.registrations?.intents ?? [];
		const quickLooks = intents.filter((i) => i.verb === "quick-look");
		expect(quickLooks.length).toBeGreaterThan(0);
		for (const ql of quickLooks) {
			expect(ql.priority).toBe("primary");
			expect(ql.mime).toBeDefined();
		}
	});

	it("registers an opener entry for every MIME it claims an intent on (manifest internally consistent)", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const intents = result.manifest.registrations?.intents ?? [];
		const openers = result.manifest.registrations?.openers ?? [];
		const intentMimes = new Set(intents.filter((i) => i.mime).map((i) => i.mime as string));
		const openerMimes = new Set(openers.filter((o) => o.mime).map((o) => o.mime as string));
		for (const mime of intentMimes) {
			expect(openerMimes.has(mime)).toBe(true);
		}
	});

	it("every MIME the manifest registers resolves to a known PreviewKind — guards against silent typos", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const intents = result.manifest.registrations?.intents ?? [];
		const intentMimes = new Set(intents.filter((i) => i.mime).map((i) => i.mime as string));
		for (const mime of intentMimes) {
			const kind = previewKindFor(mime);
			expect(kind, `previewKindFor(${mime}) should not be null`).not.toBeNull();
		}
	});

	it("declares storage.kv + entities.read:* + intents.dispatch:open caps — minimum surface for the Quick-Look-style flow", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		expect(result.manifest.capabilities).toContain("storage.kv");
		expect(result.manifest.capabilities).toContain("entities.read:*");
		expect(result.manifest.capabilities).toContain("intents.dispatch:open");
	});

	it("declares the two type-scoped writes the editable inspector needs — file properties + comments — and nothing wider", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const caps = result.manifest.capabilities;
		// Editing the previewed file's vault properties + creating/resolving its
		// comments. Scoped to the exact two types (File from Files, Comment from
		// the shared comments stack) — never the unscoped `entities.write:*`.
		expect(caps).toContain("entities.write:brainstorm/File/v1");
		expect(caps).toContain("entities.write:brainstorm/Comment/v1");
		expect(caps).not.toContain("entities.write:*");
	});

	it("REGISTERED_MIMES (logic-side reverse map) matches the manifest's intent MIMEs exactly", () => {
		const result = validateManifest(readManifest());
		if (!result.ok) throw new Error(result.reason);
		const intents = result.manifest.registrations?.intents ?? [];
		const manifestMimes = new Set(intents.filter((i) => i.mime).map((i) => i.mime as string));
		expect([...manifestMimes].sort()).toEqual([...REGISTERED_MIMES].sort());
	});
});
