import { describe, expect, it } from "vitest";
import { NodeKind, type WhiteboardNode } from "../types/node";
import { nodeLabel, selectionSummary, shouldSelectOnFocus } from "./selection-announce";

// Partial fixtures — `selectionSummary` / `nodeLabel` read only kind / text /
// title / x / y, so cast through `unknown` rather than spell out every
// per-kind field the union requires.
const base = { width: 100, height: 60, zIndex: 0 };
const sticky = (id: string, text: string, x = 10, y = 20): WhiteboardNode =>
	({ ...base, id, kind: NodeKind.Sticky, text, x, y, color: "yellow" }) as unknown as WhiteboardNode;
const frame = (id: string, title: string): WhiteboardNode =>
	({ ...base, id, kind: NodeKind.Frame, title, x: 10, y: 20 }) as unknown as WhiteboardNode;
const image = (id: string): WhiteboardNode =>
	({
		...base,
		id,
		kind: NodeKind.Image,
		imageUrl: "x",
		fit: "cover",
		x: 10,
		y: 20,
	}) as unknown as WhiteboardNode;

describe("shouldSelectOnFocus", () => {
	it("selects an unselected node (Tab-into)", () => {
		expect(shouldSelectOnFocus(new Set(), "a")).toBe(true);
		expect(shouldSelectOnFocus(new Set(["b"]), "a")).toBe(true);
	});
	it("does NOT re-select a node already in the selection (preserves multi-select on refocus)", () => {
		expect(shouldSelectOnFocus(new Set(["a"]), "a")).toBe(false);
		// The regression: after a multi-node nudge, focusSelectedNode() focuses
		// the first selected node — it must not collapse the rest away.
		expect(shouldSelectOnFocus(new Set(["a", "b", "c"]), "a")).toBe(false);
	});
});

describe("nodeLabel", () => {
	it("uses the trimmed text for sticky / text nodes", () => {
		expect(nodeLabel(sticky("a", "  Hello  "))).toBe("Hello");
	});
	it("uses the trimmed title for a frame", () => {
		expect(nodeLabel(frame("f", " Plan "))).toBe("Plan");
	});
	it("is empty for a kind with no text (caller substitutes a kind word)", () => {
		expect(nodeLabel(image("i"))).toBe("");
	});
});

describe("selectionSummary", () => {
	const nodes = [sticky("a", "Alpha", 5, 7), sticky("b", "Beta"), image("i")];

	it("reports none for an empty selection", () => {
		expect(selectionSummary(nodes, new Set())).toEqual({ kind: "none" });
	});

	it("reports none when the selected id no longer exists", () => {
		expect(selectionSummary(nodes, new Set(["gone"]))).toEqual({ kind: "none" });
	});

	it("reports a single selection with label, kind and rounded position", () => {
		expect(selectionSummary(nodes, new Set(["a"]))).toEqual({
			kind: "single",
			label: "Alpha",
			nodeKind: NodeKind.Sticky,
			x: 5,
			y: 7,
		});
	});

	it("reports a multi selection with a count of present nodes only", () => {
		expect(selectionSummary(nodes, new Set(["a", "b", "ghost"]))).toEqual({
			kind: "multi",
			count: 2,
		});
	});
});
