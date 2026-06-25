import { describe, expect, it } from "vitest";
import { matchBracket } from "./brackets";

describe("matchBracket", () => {
	const text = "f(a, [b, c]) {}";

	it("matches forward from an open bracket before the caret", () => {
		// caret right after "(" at index 2 → match the ")".
		expect(matchBracket(text, 2)).toEqual({ open: 1, close: 11 });
	});

	it("matches backward from a close bracket", () => {
		// caret right after ")" at index 12.
		expect(matchBracket(text, 12)).toEqual({ open: 1, close: 11 });
	});

	it("matches the char at the caret when none precedes it", () => {
		expect(matchBracket("[x]", 0)).toEqual({ open: 0, close: 2 });
	});

	it("respects nesting", () => {
		expect(matchBracket(text, 6)).toEqual({ open: 5, close: 10 }); // the [ ... ]
	});

	it("returns null when the caret isn't next to a bracket", () => {
		expect(matchBracket(text, 3)).toBeNull();
	});

	it("returns null for an unmatched bracket", () => {
		expect(matchBracket("foo(", 4)).toBeNull();
	});
});
