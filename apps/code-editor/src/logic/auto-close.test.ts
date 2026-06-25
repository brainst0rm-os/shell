import { describe, expect, it } from "vitest";
import {
	autoCloseOnBackspace,
	autoCloseOnClose,
	autoCloseOnOpen,
	isAutoPairCloser,
	isAutoPairOpener,
} from "./auto-close";
import type { BufferSelection } from "./line-ops";

function sel(text: string, selStart: number, selEnd = selStart): BufferSelection {
	return { text, selStart, selEnd };
}

describe("isAutoPairOpener / isAutoPairCloser", () => {
	it("recognises the bracket + quote openers and closers", () => {
		for (const o of ["(", "[", "{", '"', "'", "`"]) expect(isAutoPairOpener(o)).toBe(true);
		for (const c of [")", "]", "}", '"', "'", "`"]) expect(isAutoPairCloser(c)).toBe(true);
		expect(isAutoPairOpener("a")).toBe(false);
		expect(isAutoPairCloser("a")).toBe(false);
	});
});

describe("autoCloseOnOpen", () => {
	it("inserts the matching closer and lands the caret between", () => {
		const r = autoCloseOnOpen(sel("", 0), "(");
		expect(r).toEqual({ text: "()", selStart: 1, selEnd: 1 });
	});

	it("inserts the closer when the caret is before whitespace", () => {
		const r = autoCloseOnOpen(sel("a b", 1), "["); // caret before the space
		expect(r).toEqual({ text: "a[] b", selStart: 2, selEnd: 2 });
	});

	it("does not auto-close a bracket sitting directly before a word character", () => {
		expect(autoCloseOnOpen(sel("ab", 1), "[")).toBeNull();
	});

	it("returns null for a non-pair character", () => {
		expect(autoCloseOnOpen(sel("", 0), "a")).toBeNull();
	});

	it("wraps a non-empty selection and keeps the selection around it", () => {
		const r = autoCloseOnOpen(sel("abc", 1, 2), "("); // select "b"
		expect(r).toEqual({ text: "a(b)c", selStart: 2, selEnd: 3 });
	});

	it("does not auto-close an opener sitting before a word character", () => {
		// caret before "b": typing "(" should NOT wrap/insert a pair
		expect(autoCloseOnOpen(sel("ab", 1), "(")).toBeNull();
	});

	it("does not auto-close a quote that abuts a word (apostrophe in a word)", () => {
		expect(autoCloseOnOpen(sel("don", 3), "'")).toBeNull();
	});

	it("auto-closes a quote in whitespace context", () => {
		const r = autoCloseOnOpen(sel("x = ", 4), '"');
		expect(r).toEqual({ text: 'x = ""', selStart: 5, selEnd: 5 });
	});
});

describe("autoCloseOnClose", () => {
	it("types over an existing closer instead of duplicating it", () => {
		const r = autoCloseOnClose(sel("()", 1), ")");
		expect(r).toEqual({ text: "()", selStart: 2, selEnd: 2 });
	});

	it("returns null when the next char is not that closer", () => {
		expect(autoCloseOnClose(sel("(a)", 1), ")")).toBeNull(); // caret before "a"
	});

	it("returns null with a non-empty selection", () => {
		expect(autoCloseOnClose(sel("()", 0, 1), ")")).toBeNull();
	});

	it("returns null for a non-closer character", () => {
		expect(autoCloseOnClose(sel("ab", 1), "a")).toBeNull();
	});
});

describe("autoCloseOnBackspace", () => {
	it("deletes both halves of an empty pair", () => {
		const r = autoCloseOnBackspace(sel("()", 1));
		expect(r).toEqual({ text: "", selStart: 0, selEnd: 0 });
	});

	it("deletes both halves of an empty quote pair inside text", () => {
		const r = autoCloseOnBackspace(sel('a""b', 2));
		expect(r).toEqual({ text: "ab", selStart: 1, selEnd: 1 });
	});

	it("returns null when the caret is not between a matching pair", () => {
		expect(autoCloseOnBackspace(sel("ab", 1))).toBeNull();
		expect(autoCloseOnBackspace(sel("(x)", 2))).toBeNull();
	});

	it("returns null at the start of the buffer or with a selection", () => {
		expect(autoCloseOnBackspace(sel("()", 0))).toBeNull();
		expect(autoCloseOnBackspace(sel("()", 0, 1))).toBeNull();
	});
});
