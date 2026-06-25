/**
 * F-200: the Style menu only opens over a styleable target, and its node
 * rows are grouped under labelled sections with ONE label idiom (the section
 * heading carries the category; value rows are single words).
 */

import { describe, expect, it, vi } from "vitest";
import { WHITEBOARD_MANIFEST, createT } from "../i18n/t";
import {
	FONT_FAMILIES,
	NodeKind,
	STICKY_COLORS,
	ShapeKind,
	StickyColor,
	TEXT_COLORS,
	TEXT_SIZES,
	type WhiteboardNode,
} from "../types/node";
import { type NodeStyleHandlers, buildNodeStyleItems, hasStyleTarget } from "./style-menu";

const t = createT();

function sticky(id: string): WhiteboardNode {
	return {
		id,
		kind: NodeKind.Sticky,
		x: 0,
		y: 0,
		width: 180,
		height: 180,
		text: "",
		color: StickyColor.Yellow,
	};
}

function shape(id: string): WhiteboardNode {
	return {
		id,
		kind: NodeKind.Shape,
		x: 0,
		y: 0,
		width: 160,
		height: 120,
		shape: ShapeKind.Rectangle,
		color: StickyColor.Blue,
	};
}

function handlers(): NodeStyleHandlers {
	return {
		setTextSize: vi.fn(),
		setStickyFill: vi.fn(),
		setTextColor: vi.fn(),
		setFontFamily: vi.fn(),
		toggleBold: vi.fn(),
		toggleItalic: vi.fn(),
	};
}

describe("hasStyleTarget", () => {
	it("is false with no selection at all (trigger disabled)", () => {
		expect(hasStyleTarget(new Set(), null)).toBe(false);
	});
	it("is true with a node selection", () => {
		expect(hasStyleTarget(new Set(["a"]), null)).toBe(true);
	});
	it("is true with a selected connector", () => {
		expect(hasStyleTarget(new Set(), "edge-1")).toBe(true);
	});
});

describe("buildNodeStyleItems", () => {
	it("groups the value rows into five cascade submenus in order", () => {
		const items = buildNodeStyleItems([sticky("a")], new Set(["a"]), t, handlers());
		expect(items.map((i) => i.label)).toEqual([
			WHITEBOARD_MANIFEST["whiteboard.style.section.textSize"],
			WHITEBOARD_MANIFEST["whiteboard.style.section.fill"],
			WHITEBOARD_MANIFEST["whiteboard.style.section.textColor"],
			WHITEBOARD_MANIFEST["whiteboard.style.section.font"],
			WHITEBOARD_MANIFEST["whiteboard.style.section.emphasis"],
		]);
		// Each category carries its value rows as a child cascade, not inline.
		expect(items.map((i) => i.submenu?.length)).toEqual([
			TEXT_SIZES.length,
			STICKY_COLORS.length,
			TEXT_COLORS.length,
			FONT_FAMILIES.length,
			2,
		]);
	});

	it("uses one label idiom — no 'Category:' colon prefix on any parent or child row", () => {
		const items = buildNodeStyleItems([sticky("a")], new Set(["a"]), t, handlers());
		const everyLabel = items.flatMap((i) => [i.label, ...(i.submenu ?? []).map((c) => c.label)]);
		for (const label of everyLabel) {
			expect(label, `label "${label}" still carries a colon idiom`).not.toMatch(/:/);
		}
	});

	it("collapses an inapplicable category to a disabled row with a hint — no empty cascade", () => {
		const items = buildNodeStyleItems([shape("s")], new Set(["s"]), t, handlers());
		const textSize = items.find(
			(i) => i.label === WHITEBOARD_MANIFEST["whiteboard.style.section.textSize"],
		);
		expect(textSize?.disabled).toBe(true);
		expect(textSize?.hint).toBe(WHITEBOARD_MANIFEST["whiteboard.style.needText"]);
		expect(textSize?.submenu).toBeUndefined();
	});

	it("wires the apply handlers through the child rows' onSelect", () => {
		const h = handlers();
		const items = buildNodeStyleItems([sticky("a")], new Set(["a"]), t, h);
		const fill = items.find((i) => i.label === WHITEBOARD_MANIFEST["whiteboard.style.section.fill"]);
		fill?.submenu
			?.find((c) => c.label === WHITEBOARD_MANIFEST["whiteboard.style.fill.green"])
			?.onSelect?.();
		expect(h.setStickyFill).toHaveBeenCalledWith(StickyColor.Green);
		const emphasis = items.find(
			(i) => i.label === WHITEBOARD_MANIFEST["whiteboard.style.section.emphasis"],
		);
		emphasis?.submenu
			?.find((c) => c.label === WHITEBOARD_MANIFEST["whiteboard.style.bold"])
			?.onSelect?.();
		expect(h.toggleBold).toHaveBeenCalledTimes(1);
	});
});

describe("zoom reset labels (F-200)", () => {
	it("the two reset controls carry distinct accessible names", () => {
		expect(WHITEBOARD_MANIFEST["whiteboard.zoom.resetLevel"]).not.toBe(
			WHITEBOARD_MANIFEST["whiteboard.zoom.resetView"],
		);
	});
});
