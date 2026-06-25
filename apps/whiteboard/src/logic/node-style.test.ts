import { describe, expect, it } from "vitest";
import {
	NodeKind,
	type ShapeKind,
	StickyColor,
	TextBlockFormat,
	TextSize,
	type WhiteboardNode,
} from "../types/node";
import { FontFamily, TextColor } from "../types/node";
import {
	hasSticky,
	hasStyleableText,
	selectionBold,
	selectionItalic,
	setBoldFor,
	setFontFamilyFor,
	setItalicFor,
	setStickyFillFor,
	setTextColorFor,
	setTextSizeFor,
} from "./node-style";

const base = { x: 0, y: 0, width: 100, height: 100 };
const sticky = (id: string): WhiteboardNode => ({
	...base,
	id,
	kind: NodeKind.Sticky,
	text: "s",
	color: StickyColor.Yellow,
});
const text = (id: string): WhiteboardNode => ({
	...base,
	id,
	kind: NodeKind.Text,
	text: "t",
	format: TextBlockFormat.Plain,
});
const shape = (id: string): WhiteboardNode => ({
	...base,
	id,
	kind: NodeKind.Shape,
	shape: "rectangle" as ShapeKind,
	color: StickyColor.Blue,
});

const ids = (...xs: string[]) => new Set(xs);

describe("node-style predicates", () => {
	it("hasStyleableText is true when a sticky or text is selected", () => {
		const nodes = [sticky("a"), shape("b")];
		expect(hasStyleableText(nodes, ids("a"))).toBe(true);
		expect(hasStyleableText(nodes, ids("b"))).toBe(false);
		expect(hasStyleableText([text("t")], ids("t"))).toBe(true);
	});

	it("hasSticky is true only for a selected sticky", () => {
		const nodes = [sticky("a"), text("b")];
		expect(hasSticky(nodes, ids("a"))).toBe(true);
		expect(hasSticky(nodes, ids("b"))).toBe(false);
	});
});

describe("setTextSizeFor", () => {
	it("sets the size on selected text-bearing nodes only", () => {
		const nodes = [sticky("a"), text("b"), shape("c")];
		const out = setTextSizeFor(nodes, ids("a", "b", "c"), TextSize.Large);
		expect((out[0] as { textSize?: TextSize }).textSize).toBe(TextSize.Large);
		expect((out[1] as { textSize?: TextSize }).textSize).toBe(TextSize.Large);
		// Shape has no textSize and is passed through by reference.
		expect(out[2]).toBe(nodes[2]);
	});

	it("leaves unselected nodes referentially unchanged", () => {
		const nodes = [sticky("a"), sticky("b")];
		const out = setTextSizeFor(nodes, ids("a"), TextSize.Small);
		expect(out[0]).not.toBe(nodes[0]);
		expect(out[1]).toBe(nodes[1]);
	});
});

describe("setStickyFillFor", () => {
	it("recolours selected stickies only", () => {
		const nodes = [sticky("a"), text("b")];
		const out = setStickyFillFor(nodes, ids("a", "b"), StickyColor.Pink);
		expect((out[0] as { color: StickyColor }).color).toBe(StickyColor.Pink);
		// Text node is untouched (no sticky fill).
		expect(out[1]).toBe(nodes[1]);
	});
});

describe("setTextColorFor / setFontFamilyFor (9.17.12)", () => {
	it("sets text colour on selected text-bearing nodes only", () => {
		const nodes = [sticky("a"), text("b"), shape("c")];
		const out = setTextColorFor(nodes, ids("a", "b", "c"), TextColor.Blue);
		expect((out[0] as { textColor?: TextColor }).textColor).toBe(TextColor.Blue);
		expect((out[1] as { textColor?: TextColor }).textColor).toBe(TextColor.Blue);
		// Shape is text-less → passed through by reference.
		expect(out[2]).toBe(nodes[2]);
	});

	it("sets font family on selected text-bearing nodes only", () => {
		const nodes = [sticky("a"), shape("b")];
		const out = setFontFamilyFor(nodes, ids("a", "b"), FontFamily.Mono);
		expect((out[0] as { fontFamily?: FontFamily }).fontFamily).toBe(FontFamily.Mono);
		expect(out[1]).toBe(nodes[1]);
	});
});

describe("setBoldFor / setItalicFor (9.17.12)", () => {
	it("sets bold on selected text-bearing nodes only", () => {
		const nodes = [sticky("a"), text("b"), shape("c")];
		const out = setBoldFor(nodes, ids("a", "b", "c"), true);
		expect((out[0] as { bold?: boolean }).bold).toBe(true);
		expect((out[1] as { bold?: boolean }).bold).toBe(true);
		// Shape is text-less → passed through by reference.
		expect(out[2]).toBe(nodes[2]);
	});

	it("clears bold when set to false", () => {
		const nodes = [{ ...sticky("a"), bold: true } as WhiteboardNode];
		const out = setBoldFor(nodes, ids("a"), false);
		expect((out[0] as { bold?: boolean }).bold).toBe(false);
	});

	it("sets italic on selected text-bearing nodes only", () => {
		const nodes = [sticky("a"), shape("b")];
		const out = setItalicFor(nodes, ids("a", "b"), true);
		expect((out[0] as { italic?: boolean }).italic).toBe(true);
		expect(out[1]).toBe(nodes[1]);
	});

	it("leaves unselected nodes referentially unchanged", () => {
		const nodes = [sticky("a"), sticky("b")];
		const out = setBoldFor(nodes, ids("a"), true);
		expect(out[0]).not.toBe(nodes[0]);
		expect(out[1]).toBe(nodes[1]);
	});
});

describe("selectionBold / selectionItalic (9.17.12)", () => {
	it("is true only when every styleable selected node carries the flag", () => {
		const nodes = [
			{ ...sticky("a"), bold: true } as WhiteboardNode,
			{ ...text("b"), bold: true } as WhiteboardNode,
			{ ...sticky("c") } as WhiteboardNode,
		];
		expect(selectionBold(nodes, ids("a", "b"))).toBe(true);
		// Mixed selection (c is not bold) reads as false.
		expect(selectionBold(nodes, ids("a", "b", "c"))).toBe(false);
	});

	it("is false when no styleable node is selected", () => {
		const nodes = [shape("a")];
		expect(selectionBold(nodes, ids("a"))).toBe(false);
		expect(selectionItalic(nodes, ids("a"))).toBe(false);
		expect(selectionBold(nodes, ids())).toBe(false);
	});

	it("ignores text-less nodes in the selection", () => {
		const nodes = [{ ...text("a"), italic: true } as WhiteboardNode, shape("b")];
		expect(selectionItalic(nodes, ids("a", "b"))).toBe(true);
	});
});
