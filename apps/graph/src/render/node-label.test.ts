/**
 * `nodeLabel` — the shared SVG/Pixi node-label resolver. Regression cover
 * for the Pixi label-clip bug: the overlay used to render the *raw* name
 * with no cap (and no CSS rule), so a long entity name overflowed the
 * canvas. These assertions pin the hard character ceiling both renderers
 * now share.
 */

import { describe, expect, it } from "vitest";
import type { EntityRow } from "../logic/in-memory-graph";
import { NODE_LABEL_MAX_CHARS, nodeLabel, rawNodeLabel } from "./node-label";

function entity(props: Record<string, unknown>, id = "abcdef0123456789"): EntityRow {
	return { id, type: "io.brainstorm.notes/Note/v1", properties: props } as EntityRow;
}

describe("rawNodeLabel", () => {
	it("prefers name, then title, then an id prefix", () => {
		expect(rawNodeLabel(entity({ name: "Alpha", title: "Beta" }))).toBe("Alpha");
		expect(rawNodeLabel(entity({ title: "Beta" }))).toBe("Beta");
		expect(rawNodeLabel(entity({}))).toBe("abcdef01");
	});

	it("only nullish name falls back (mirrors the pre-extraction `?? id`)", () => {
		// `?? title ?? id` — an empty string is present, not nullish, so it
		// is kept verbatim exactly as both renderers did before extraction.
		expect(rawNodeLabel(entity({ name: "", title: "Gamma" }))).toBe("");
		expect(rawNodeLabel(entity({ title: null }))).toBe("abcdef01");
	});
});

describe("nodeLabel truncation (Pixi label-clip regression)", () => {
	it("returns short names verbatim", () => {
		expect(nodeLabel(entity({ name: "Short name" }))).toBe("Short name");
	});

	it("caps at NODE_LABEL_MAX_CHARS with an ellipsis", () => {
		const long = "x".repeat(200);
		const out = nodeLabel(entity({ name: long }));
		expect(out.length).toBe(NODE_LABEL_MAX_CHARS);
		expect(out.endsWith("…")).toBe(true);
		expect(out).toBe(`${"x".repeat(NODE_LABEL_MAX_CHARS - 1)}…`);
	});

	it("never overflows the cap regardless of input length", () => {
		for (const n of [NODE_LABEL_MAX_CHARS, NODE_LABEL_MAX_CHARS + 1, 5000]) {
			expect(nodeLabel(entity({ name: "a".repeat(n) })).length).toBeLessThanOrEqual(
				NODE_LABEL_MAX_CHARS,
			);
		}
	});

	it("trims trailing whitespace before the ellipsis", () => {
		const name = `${"word ".repeat(20)}`; // spaces land near the cut
		const out = nodeLabel(entity({ name }));
		expect(out).not.toMatch(/ …$/);
		expect(out.endsWith("…")).toBe(true);
	});

	it("keeps a boundary-length name (exactly the cap) verbatim", () => {
		const exact = "z".repeat(NODE_LABEL_MAX_CHARS);
		expect(nodeLabel(entity({ name: exact }))).toBe(exact);
	});
});
