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
	it("prefers name, then title", () => {
		expect(rawNodeLabel(entity({ name: "Alpha", title: "Beta" }))).toBe("Alpha");
		expect(rawNodeLabel(entity({ title: "Beta" }))).toBe("Beta");
	});

	it("falls back to a human type caption, never a raw id fragment (F-320)", () => {
		// The old `?? entity.id.slice(0, 8)` painted "ent_mr15" on every
		// title-less node (the shared `ent_<base36-timestamp>` prefix is
		// identical for every entity minted the same day). The fallback must
		// read like a thing, not an internal.
		const label = rawNodeLabel(entity({}));
		expect(label).toBe("Note (untitled)");
		expect(label).not.toContain("abcdef01");
	});

	it("skips empty / whitespace-only / non-string name and title", () => {
		// An empty `name` no longer shadows a real `title` (the pre-F-320
		// `??` chain kept "" verbatim and painted a blank label).
		expect(rawNodeLabel(entity({ name: "", title: "Gamma" }))).toBe("Gamma");
		expect(rawNodeLabel(entity({ name: "   ", title: null }))).toBe("Note (untitled)");
		expect(rawNodeLabel(entity({ name: 42, title: { rich: true } }))).toBe("Note (untitled)");
	});

	it("derives the caption's type name from the entity type id", () => {
		const task = { ...entity({}), type: "brainstorm/Task/v1" } as EntityRow;
		expect(rawNodeLabel(task)).toBe("Task (untitled)");
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

	it("truncates from the END only — the output is always a prefix (F-320)", () => {
		// Guards the leading-clip class ("Note" must never surface as "ote"):
		// whatever the cap does, the painted text starts with the name's own
		// first characters and the ellipsis sits at the tail.
		for (const name of ["Note", "Content Calendar", `Prefix ${"y".repeat(200)}`]) {
			const out = nodeLabel(entity({ name }));
			const body = out.endsWith("…") ? out.slice(0, -1) : out;
			expect(name.startsWith(body)).toBe(true);
			expect(out.startsWith(name[0] as string)).toBe(true);
		}
	});
});
