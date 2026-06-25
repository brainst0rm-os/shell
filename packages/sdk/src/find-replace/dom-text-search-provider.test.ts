// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createDomTextSearchProvider } from "./dom-text-search-provider";
import { DEFAULT_FIND_OPTIONS, type FindQuery } from "./find-controller";

const q = (term: string, opts: Partial<FindQuery["options"]> = {}): FindQuery => ({
	term,
	options: { ...DEFAULT_FIND_OPTIONS, ...opts },
});

function root(html: string): HTMLElement {
	const el = document.createElement("div");
	el.innerHTML = html;
	document.body.replaceChildren(el);
	return el;
}

describe("createDomTextSearchProvider — search", () => {
	it("finds every occurrence as flat offsets, case-insensitive by default", () => {
		const el = root("<p>The fox and the Fox</p>");
		const p = createDomTextSearchProvider(() => el);
		expect(p.search(q("fox"))).toEqual([
			{ start: 4, end: 7 },
			{ start: 16, end: 19 },
		]);
	});

	it("honours caseSensitive and wholeWord", () => {
		const el = root("<p>Fox foxes fox</p>");
		const p = createDomTextSearchProvider(() => el);
		// "Fox" (cap F) excluded; "fox" inside "foxes" at 4, trailing "fox" at 10
		expect(p.search(q("fox", { caseSensitive: true }))).toEqual([
			{ start: 4, end: 7 },
			{ start: 10, end: 13 },
		]);
		// wholeWord excludes the "fox" inside "foxes"
		expect(p.search(q("fox", { wholeWord: true })).length).toBe(2);
	});

	it("spans text across nested elements (offsets are over textContent)", () => {
		const el = root("<p>al<b>pha</b> beta</p>");
		const p = createDomTextSearchProvider(() => el);
		expect(p.search(q("alpha"))).toEqual([{ start: 0, end: 5 }]);
		expect(p.search(q("beta"))).toEqual([{ start: 6, end: 10 }]);
	});

	it("empty term or absent root → no matches", () => {
		const el = root("<p>text</p>");
		expect(createDomTextSearchProvider(() => el).search(q(""))).toEqual([]);
		expect(createDomTextSearchProvider(() => null).search(q("text"))).toEqual([]);
	});

	it("treats the term literally (regex metachars are escaped)", () => {
		const el = root("<p>a.b a+b axb</p>");
		const p = createDomTextSearchProvider(() => el);
		expect(p.search(q("a.b"))).toEqual([{ start: 0, end: 3 }]);
	});
});

describe("createDomTextSearchProvider — reveal & clear", () => {
	it("wraps a single-node match in a transient <mark> and restores it on clear", () => {
		const el = root("<p>hello world</p>");
		const p = createDomTextSearchProvider(() => el);
		const [m] = p.search(q("world"));
		p.revealMatch(m);
		const mark = el.querySelector("mark[data-bs-find]");
		expect(mark?.textContent).toBe("world");
		expect(mark?.className).toBe("bs-find-hit");
		p.clear();
		expect(el.querySelector("mark[data-bs-find]")).toBeNull();
		expect(el.textContent).toBe("hello world");
		// normalized back to a single text node
		expect(el.querySelector("p")?.childNodes.length).toBe(1);
	});

	it("re-revealing clears the previous highlight (only one mark at a time)", () => {
		const el = root("<p>one two one</p>");
		const p = createDomTextSearchProvider(() => el);
		const ms = p.search(q("one"));
		p.revealMatch(ms[0]);
		p.revealMatch(ms[1]);
		expect(el.querySelectorAll("mark[data-bs-find]").length).toBe(1);
		expect(el.querySelector("mark[data-bs-find]")?.textContent).toBe("one");
	});

	it("a cross-element match reveals without wrapping and does not throw", () => {
		const el = root("<p>al<b>pha</b></p>");
		const p = createDomTextSearchProvider(() => el);
		const [m] = p.search(q("alpha"));
		expect(() => p.revealMatch(m)).not.toThrow();
		expect(el.querySelector("mark[data-bs-find]")).toBeNull();
		expect(el.textContent).toBe("alpha");
	});
});

describe("createDomTextSearchProvider — read-only seam", () => {
	it("is find-only: replace* are no-ops and selectionRange is null", () => {
		const el = root("<p>immutable</p>");
		const p = createDomTextSearchProvider(() => el);
		expect(p.selectionRange).toBeNull();
		expect(p.replaceAll(q("immutable"), "x")).toBe(0);
		expect(() => p.replaceMatch({ start: 0, end: 9 }, "x")).not.toThrow();
		expect(el.textContent).toBe("immutable");
	});
});
