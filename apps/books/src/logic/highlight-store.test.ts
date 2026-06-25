import { describe, expect, it, vi } from "vitest";
import { type Highlight, HighlightColor } from "../types/highlight";
import { makeLocator } from "../types/locator";
import {
	HighlightStore,
	composeHighlight,
	highlightOverlapsRange,
	highlightSpanInFragment,
	highlightsOnPage,
	sortHighlights,
} from "./highlight-store";
import type { ResolvedSelection } from "./selection-locator";

function selection(startOffset: number, endOffset: number, quote: string): ResolvedSelection {
	return {
		range: { start: makeLocator(0, startOffset), end: makeLocator(0, endOffset) },
		quote,
	};
}

function makeHighlight(
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

describe("composeHighlight", () => {
	it("builds a Highlight/v1 from a resolved selection", () => {
		const h = composeHighlight({
			bookId: "book-1",
			color: HighlightColor.Green,
			selection: selection(10, 4, "swapped"),
			note: "  a note  ",
			now: 123,
			id: "hl-1",
		});
		expect(h.id).toBe("hl-1");
		expect(h.bookId).toBe("book-1");
		expect(h.color).toBe(HighlightColor.Green);
		// normalized: start <= end
		expect(h.anchor.start).toEqual(makeLocator(0, 4));
		expect(h.anchor.end).toEqual(makeLocator(0, 10));
		expect(h.quote).toBe("swapped");
		expect(h.note).toBe("a note");
		expect(h.createdAt).toBe(123);
		expect(h.updatedAt).toBe(123);
	});

	it("defaults an absent note to empty", () => {
		const h = composeHighlight({
			bookId: "b",
			color: HighlightColor.Blue,
			selection: selection(0, 5, "x"),
			now: 1,
			id: "i",
		});
		expect(h.note).toBe("");
	});
});

describe("query helpers", () => {
	it("sorts by anchor start then end", () => {
		const sorted = sortHighlights([
			makeHighlight("b", 5, 10),
			makeHighlight("a", 0, 3),
			makeHighlight("c", 5, 8),
		]);
		expect(sorted.map((h) => h.id)).toEqual(["a", "c", "b"]);
	});

	it("detects overlap (start-inclusive / end-exclusive)", () => {
		const page = { start: makeLocator(0, 10), end: makeLocator(0, 20) };
		expect(highlightOverlapsRange(makeHighlight("x", 5, 11), page)).toBe(true);
		expect(highlightOverlapsRange(makeHighlight("x", 0, 10), page)).toBe(false); // touches at boundary
		expect(highlightOverlapsRange(makeHighlight("x", 20, 25), page)).toBe(false);
	});

	it("returns the page's highlights in reading order", () => {
		const page = { start: makeLocator(0, 0), end: makeLocator(0, 30) };
		const on = highlightsOnPage(
			[makeHighlight("b", 20, 25), makeHighlight("a", 0, 5), makeHighlight("off", 40, 50)],
			page,
		);
		expect(on.map((h) => h.id)).toEqual(["a", "b"]);
	});

	it("clips a highlight to a fragment", () => {
		const span = highlightSpanInFragment(makeHighlight("h", 12, 18), 10, 20);
		expect(span).toEqual({ highlightId: "h", color: HighlightColor.Yellow, from: 2, to: 8 });
		expect(highlightSpanInFragment(makeHighlight("h", 0, 5), 10, 20)).toBeNull();
	});
});

describe("HighlightStore", () => {
	it("adds + sorts + notifies + forwards to the port", () => {
		const create = vi.fn();
		const store = new HighlightStore({ create });
		const listener = vi.fn();
		store.subscribe(listener);
		store.add(makeHighlight("b", 10, 15));
		store.add(makeHighlight("a", 0, 5));
		expect(store.list().map((h) => h.id)).toEqual(["a", "b"]);
		expect(create).toHaveBeenCalledTimes(2);
		expect(listener).toHaveBeenCalledTimes(2);
	});

	it("recolours and re-notes through the port", () => {
		const update = vi.fn();
		const store = new HighlightStore({ update }, [makeHighlight("a", 0, 5)]);
		store.setColor("a", HighlightColor.Pink, 50);
		expect(store.get("a")?.color).toBe(HighlightColor.Pink);
		expect(store.get("a")?.updatedAt).toBe(50);
		store.setNote("a", "  hi  ", 60);
		expect(store.get("a")?.note).toBe("hi");
		expect(update).toHaveBeenCalledTimes(2);
	});

	it("removes through the port and reports unknown ids", () => {
		const remove = vi.fn();
		const store = new HighlightStore({ remove }, [makeHighlight("a", 0, 5)]);
		expect(store.remove("a")).toBe(true);
		expect(store.list()).toHaveLength(0);
		expect(remove).toHaveBeenCalledWith("a");
		expect(store.remove("nope")).toBe(false);
	});

	it("an unsubscribed listener stops receiving updates", () => {
		const store = new HighlightStore();
		const listener = vi.fn();
		const off = store.subscribe(listener);
		off();
		store.add(makeHighlight("a", 0, 5));
		expect(listener).not.toHaveBeenCalled();
	});

	it("mutating an unknown id is a no-op", () => {
		const store = new HighlightStore();
		expect(store.setColor("nope", HighlightColor.Blue, 1)).toBeNull();
		expect(store.setNote("nope", "x", 1)).toBeNull();
	});
});
