/**
 * 9.7.3 — multi-cursor / column-selection model. Index 0 is always the
 * primary (textarea) cursor; the edit fan-out must keep index alignment
 * so the pane can restore the primary selection after every edit.
 */
import { describe, expect, it } from "vitest";
import {
	type CursorRange,
	MultiEditKind,
	VerticalDirection,
	addCursorVertically,
	applyMultiCursorEdit,
	normalizeCursors,
	selectNextOccurrence,
	wordRangeAt,
} from "./multi-cursor";

const caret = (at: number): CursorRange => ({ anchor: at, head: at });

describe("normalizeCursors", () => {
	it("drops exact duplicates, keeping the first", () => {
		expect(normalizeCursors([caret(3), caret(3), caret(5)])).toEqual([caret(3), caret(5)]);
	});

	it("drops overlapping ranges in favour of the earlier-listed cursor", () => {
		const primary: CursorRange = { anchor: 2, head: 8 };
		expect(normalizeCursors([primary, { anchor: 4, head: 6 }])).toEqual([primary]);
	});

	it("keeps touching-but-disjoint ranges", () => {
		const a: CursorRange = { anchor: 0, head: 3 };
		const b: CursorRange = { anchor: 3, head: 6 };
		expect(normalizeCursors([a, b])).toEqual([a, b]);
	});
});

describe("addCursorVertically (column selection)", () => {
	const text = "alpha\nbe\ngamma";

	it("adds a collapsed cursor at the same column on the next line", () => {
		const result = addCursorVertically(text, [caret(2)], VerticalDirection.Down);
		expect(result).toHaveLength(2);
		expect(result[1]).toMatchObject({ anchor: 8, head: 8 });
	});

	it("clamps to a shorter line but keeps the goal column for the next step", () => {
		// Column 4 on line 0; line 1 ("be") is 2 chars → clamps to its end.
		const step1 = addCursorVertically(text, [caret(4)], VerticalDirection.Down);
		expect(step1[1]).toMatchObject({ anchor: 8, head: 8, goalColumn: 4 });
		// Stepping again from the clamped cursor recovers column 4 on "gamma".
		const step2 = addCursorVertically(text, step1, VerticalDirection.Down);
		const last = step2[step2.length - 1];
		expect(last).toMatchObject({ anchor: 13, head: 13 });
	});

	it("adds nothing above the first line", () => {
		expect(addCursorVertically(text, [caret(2)], VerticalDirection.Up)).toHaveLength(1);
	});
});

describe("wordRangeAt / selectNextOccurrence", () => {
	it("finds the word around a caret", () => {
		expect(wordRangeAt("foo bar", 5)).toEqual({ from: 4, to: 7 });
		expect(wordRangeAt("foo bar", 3)).toEqual({ from: 0, to: 3 });
		expect(wordRangeAt("a  b", 2)).toBeNull();
	});

	it("collapsed primary first selects the word under the caret", () => {
		const result = selectNextOccurrence("foo bar foo", [caret(1)]);
		expect(result).toEqual([{ anchor: 0, head: 3 }]);
	});

	it("then grows one occurrence selection per invocation, wrapping", () => {
		const text = "foo bar foo baz foo";
		let cursors: CursorRange[] = [{ anchor: 0, head: 3 }];
		cursors = selectNextOccurrence(text, cursors);
		expect(cursors).toEqual([
			{ anchor: 0, head: 3 },
			{ anchor: 8, head: 11 },
		]);
		cursors = selectNextOccurrence(text, cursors);
		expect(cursors).toHaveLength(3);
		// All occurrences claimed → the set stays stable.
		expect(selectNextOccurrence(text, cursors)).toHaveLength(3);
	});
});

describe("applyMultiCursorEdit", () => {
	it("inserts at every cursor and returns index-aligned collapsed cursors", () => {
		const { text, cursors } = applyMultiCursorEdit("ab\ncd", [caret(1), caret(4)], {
			kind: MultiEditKind.Insert,
			text: "X",
		});
		expect(text).toBe("aXb\ncXd");
		expect(cursors).toEqual([caret(2), caret(6)]);
	});

	it("keeps index alignment even when cursors are listed out of order", () => {
		// Primary (index 0) sits AFTER the secondary in the buffer.
		const { text, cursors } = applyMultiCursorEdit("ab\ncd", [caret(4), caret(1)], {
			kind: MultiEditKind.Insert,
			text: "X",
		});
		expect(text).toBe("aXb\ncXd");
		expect(cursors[0]).toEqual(caret(6));
		expect(cursors[1]).toEqual(caret(2));
	});

	it("replaces range selections with the inserted text", () => {
		const { text, cursors } = applyMultiCursorEdit(
			"foo bar foo",
			[
				{ anchor: 0, head: 3 },
				{ anchor: 8, head: 11 },
			],
			{ kind: MultiEditKind.Insert, text: "qux" },
		);
		expect(text).toBe("qux bar qux");
		expect(cursors).toEqual([caret(3), caret(11)]);
	});

	it("backspace deletes one char before each collapsed cursor", () => {
		const { text, cursors } = applyMultiCursorEdit("aXb\ncXd", [caret(2), caret(6)], {
			kind: MultiEditKind.DeleteBackward,
		});
		expect(text).toBe("ab\ncd");
		expect(cursors).toEqual([caret(1), caret(4)]);
	});

	it("backspace at offset 0 is a safe no-op for that cursor", () => {
		const { text } = applyMultiCursorEdit("ab", [caret(0), caret(2)], {
			kind: MultiEditKind.DeleteBackward,
		});
		expect(text).toBe("a");
	});

	it("delete-forward removes the next char at each cursor", () => {
		const { text } = applyMultiCursorEdit("aXb\ncXd", [caret(1), caret(5)], {
			kind: MultiEditKind.DeleteForward,
		});
		expect(text).toBe("ab\ncd");
	});

	it("newline insert fans out (the column-edit classic)", () => {
		const { text } = applyMultiCursorEdit("ab", [caret(1), caret(2)], {
			kind: MultiEditKind.Insert,
			text: "\n",
		});
		expect(text).toBe("a\nb\n");
	});
});
