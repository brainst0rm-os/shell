// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { BlockKind } from "../logic/content";
import type { PageFragment } from "../logic/page-slice";
import { type Highlight, HighlightColor } from "../types/highlight";
import { makeLocator } from "../types/locator";
import {
	buildHighlightsPanel,
	buildSelectionMenu,
	paintFragment,
	readFragmentSelection,
} from "./highlights";

function fragment(text: string, spineOffset: number): PageFragment {
	return { kind: BlockKind.Paragraph, text, spineOffset };
}

function highlight(
	id: string,
	start: number,
	end: number,
	color = HighlightColor.Yellow,
): Highlight {
	return {
		id,
		bookId: "b",
		anchor: { start: makeLocator(0, start), end: makeLocator(0, end) },
		color,
		quote: "q",
		note: "",
		createdAt: 0,
		updatedAt: 0,
	};
}

describe("paintFragment", () => {
	it("renders plain text when no highlight overlaps", () => {
		const p = document.createElement("p");
		paintFragment(p, fragment("Hello world", 0), 0, [], () => {});
		expect(p.textContent).toBe("Hello world");
		expect(p.querySelector("mark")).toBeNull();
		expect(p.getAttribute("data-fragment-index")).toBe("0");
	});

	it("wraps the highlighted span in a coloured mark and keeps surrounding text", () => {
		const p = document.createElement("p");
		paintFragment(
			p,
			fragment("Hello world", 0),
			0,
			[highlight("h", 6, 11, HighlightColor.Green)],
			() => {},
		);
		const mark = p.querySelector("mark");
		expect(mark?.textContent).toBe("world");
		expect(mark?.classList.contains("books__mark--green")).toBe(true);
		expect(mark?.dataset.highlightId).toBe("h");
		expect(p.textContent).toBe("Hello world");
	});

	it("clicking a mark fires the callback with the highlight id", () => {
		const onClick = vi.fn();
		const p = document.createElement("p");
		paintFragment(p, fragment("Hello world", 0), 0, [highlight("h", 0, 5)], onClick);
		p.querySelector("mark")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(onClick).toHaveBeenCalledWith("h");
	});

	it("de-overlaps two highlights sharing offsets", () => {
		const p = document.createElement("p");
		paintFragment(
			p,
			fragment("abcdef", 0),
			0,
			[highlight("a", 0, 4), highlight("b", 2, 6)],
			() => {},
		);
		const marks = p.querySelectorAll("mark");
		expect(marks.length).toBe(2);
		expect(p.textContent).toBe("abcdef");
	});
});

describe("readFragmentSelection", () => {
	it("returns null for a collapsed selection", () => {
		const page = document.createElement("article");
		const p = document.createElement("p");
		p.setAttribute("data-fragment-index", "0");
		p.textContent = "abc";
		page.append(p);
		const sel = {
			rangeCount: 1,
			isCollapsed: true,
			anchorNode: p.firstChild,
			anchorOffset: 1,
			focusNode: p.firstChild,
			focusOffset: 1,
		} as unknown as Selection;
		expect(readFragmentSelection(page, sel)).toBeNull();
	});

	it("maps a text selection back to fragment points", () => {
		const page = document.createElement("article");
		const p = document.createElement("p");
		p.setAttribute("data-fragment-index", "0");
		p.textContent = "abcdef";
		page.append(p);
		const sel = {
			rangeCount: 1,
			isCollapsed: false,
			anchorNode: p.firstChild,
			anchorOffset: 1,
			focusNode: p.firstChild,
			focusOffset: 4,
		} as unknown as Selection;
		expect(readFragmentSelection(page, sel)).toEqual({
			anchor: { fragmentIndex: 0, offset: 1 },
			focus: { fragmentIndex: 0, offset: 4 },
		});
	});

	it("sums the offset across a mark child", () => {
		const page = document.createElement("article");
		const p = document.createElement("p");
		p.setAttribute("data-fragment-index", "2");
		const text = document.createTextNode("ab");
		const mark = document.createElement("mark");
		mark.textContent = "cd";
		const tail = document.createTextNode("ef");
		p.append(text, mark, tail);
		page.append(p);
		const sel = {
			rangeCount: 1,
			isCollapsed: false,
			anchorNode: text,
			anchorOffset: 1,
			focusNode: tail,
			focusOffset: 1,
		} as unknown as Selection;
		expect(readFragmentSelection(page, sel)).toEqual({
			anchor: { fragmentIndex: 2, offset: 1 },
			focus: { fragmentIndex: 2, offset: 5 },
		});
	});
});

describe("buildSelectionMenu", () => {
	function build() {
		const onConfirm = vi.fn();
		const onCancel = vi.fn();
		const menu = buildSelectionMenu({ quote: "the anchor model", onConfirm, onCancel });
		return { menu, onConfirm, onCancel };
	}

	it("previews the selected quote", () => {
		const { menu } = build();
		expect(menu.body.querySelector(".books__hl-preview")?.textContent).toBe("the anchor model");
	});

	it("renders one swatch per colour with yellow pre-selected", () => {
		const { menu } = build();
		const swatches = menu.body.querySelectorAll(".books__hl-swatch");
		expect(swatches.length).toBe(5);
		expect(swatches[0]?.getAttribute("aria-checked")).toBe("true");
		expect(swatches[1]?.getAttribute("aria-checked")).toBe("false");
	});

	it("confirm reports the picked colour after a swatch click", () => {
		const { menu, onConfirm } = build();
		const swatches = menu.body.querySelectorAll<HTMLButtonElement>(".books__hl-swatch");
		swatches[1]?.click();
		expect(swatches[1]?.getAttribute("aria-checked")).toBe("true");
		expect(swatches[0]?.getAttribute("aria-checked")).toBe("false");
		expect(onConfirm).not.toHaveBeenCalled();
		menu.footer.querySelector<HTMLButtonElement>(".books__hl-confirm")?.click();
		expect(onConfirm).toHaveBeenCalledWith(HighlightColor.Green);
	});

	it("confirm without a pick uses the default colour", () => {
		const { menu, onConfirm } = build();
		menu.footer.querySelector<HTMLButtonElement>(".books__hl-confirm")?.click();
		expect(onConfirm).toHaveBeenCalledWith(HighlightColor.Yellow);
	});

	it("cancel fires onCancel and never confirms", () => {
		const { menu, onConfirm, onCancel } = build();
		menu.footer.querySelector<HTMLButtonElement>(".books__hl-cancel")?.click();
		expect(onCancel).toHaveBeenCalledTimes(1);
		expect(onConfirm).not.toHaveBeenCalled();
	});
});

describe("buildHighlightsPanel", () => {
	const actions = {
		onGoTo: vi.fn(),
		onSetColor: vi.fn(),
		onSetNote: vi.fn(),
		onRemove: vi.fn(),
	};

	it("shows the empty state with a zero count", () => {
		const panel = buildHighlightsPanel([], actions);
		expect(panel.querySelector(".books__hl-empty")).not.toBeNull();
		expect(panel.querySelector(".books__hl-count")?.textContent).toContain("0");
	});

	it("lists highlights with quote, recolour swatches, note + a count", () => {
		const h = { ...highlight("h", 0, 5, HighlightColor.Blue), quote: "covered text", note: "hi" };
		const panel = buildHighlightsPanel([h], actions);
		expect(panel.querySelector(".books__hl-count")?.textContent).toContain("1");
		expect(panel.querySelector(".books__hl-quote")?.textContent).toBe("covered text");
		expect(panel.querySelector<HTMLTextAreaElement>(".books__hl-note")?.value).toBe("hi");
		expect(panel.querySelectorAll(".books__hl-recolor .books__hl-swatch").length).toBe(5);
	});

	it("wires go-to, recolour, note + remove actions", () => {
		const h = highlight("h", 0, 5);
		const panel = buildHighlightsPanel([h], actions);
		panel.querySelector<HTMLButtonElement>(".books__hl-quote")?.click();
		expect(actions.onGoTo).toHaveBeenCalledWith(h.anchor);
		panel.querySelector<HTMLButtonElement>(".books__hl-recolor .books__hl-swatch--pink")?.click();
		expect(actions.onSetColor).toHaveBeenCalledWith("h", HighlightColor.Pink);
		const note = panel.querySelector<HTMLTextAreaElement>(".books__hl-note");
		if (note) {
			note.value = "new note";
			note.dispatchEvent(new Event("change"));
		}
		expect(actions.onSetNote).toHaveBeenCalledWith("h", "new note");
		panel.querySelector<HTMLButtonElement>(".books__hl-remove")?.click();
		expect(actions.onRemove).toHaveBeenCalledWith("h");
	});
});
