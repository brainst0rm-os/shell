/**
 * @vitest-environment jsdom
 *
 * `readEntityIcon` enforces the per-object-icons-everywhere invariant in
 * the Database inspector: it returns the object's OWN validated `Icon`
 * (so the inspector + grid render it), or `null` so the caller falls
 * back to the *type* glyph — never the type glyph as the object's icon.
 * Importing `app.ts` boots it; mirror the boot-smoke DOM scaffold so the
 * render path doesn't crash at module-eval.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IconKind } from "@brainstorm/sdk-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const BODY_HTML = readFileSync(join(__dirname, "../src/index.html"), "utf8")
	.replace(/[\s\S]*<body[^>]*>/i, "")
	.replace(/<\/body>[\s\S]*/i, "");

beforeEach(() => {
	vi.resetModules();
	(window as { brainstorm?: unknown }).brainstorm = undefined;
	if (!("ResizeObserver" in window)) {
		(window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		};
	}
	if (!window.matchMedia) {
		(window as unknown as { matchMedia: unknown }).matchMedia = () => ({
			matches: false,
			addEventListener() {},
			removeEventListener() {},
		});
	}
	document.body.innerHTML = BODY_HTML;
});

function row(properties: Record<string, unknown>) {
	return {
		id: "e1",
		type: "io.brainstorm.Note/v1",
		properties,
		createdAt: 0,
		updatedAt: 0,
		deletedAt: null,
	};
}

// The dynamic `import("../src/app")` pulls in the full renderer graph;
// cold-transform on a contended worker can blow past vitest's 5s default,
// so widen the per-test timeout to keep the suite reliable.
describe("readEntityIcon (per-object-icons-everywhere)", { timeout: 30_000 }, () => {
	it("returns the object's own emoji / pack / image icon verbatim", async () => {
		const { readEntityIcon } = await import("../src/app");
		expect(readEntityIcon(row({ icon: { kind: IconKind.Emoji, value: "🌟" } }))).toEqual({
			kind: IconKind.Emoji,
			value: "🌟",
		});
		expect(readEntityIcon(row({ icon: { kind: IconKind.Pack, value: "phosphor/star" } }))?.kind).toBe(
			IconKind.Pack,
		);
		expect(
			readEntityIcon(row({ icon: { kind: IconKind.Image, value: "brainstorm://icon/a.png" } }))?.value,
		).toBe("brainstorm://icon/a.png");
	});

	it("returns null (→ type-glyph fallback) when there is no valid own icon", async () => {
		const { readEntityIcon } = await import("../src/app");
		expect(readEntityIcon(row({}))).toBeNull();
		expect(readEntityIcon(row({ icon: null }))).toBeNull();
		expect(readEntityIcon(row({ icon: "🌟" }))).toBeNull();
		expect(readEntityIcon(row({ icon: { kind: IconKind.Emoji, value: "" } }))).toBeNull();
		expect(readEntityIcon(row({ icon: { kind: "bogus", value: "x" } }))).toBeNull();
	});
});
