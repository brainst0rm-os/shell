/**
 * Pure tests for the lazy notes→body migration helpers (9.14.6). The
 * data-loss-safety contract lives here: a legacy `notes` string is only
 * cleared once, and only after it's been carried into the body.
 */

import { describe, expect, it } from "vitest";
import { hasLegacyNotes, notesStringToSerializedState, shouldClearLegacyNotes } from "./seed-body";

type Node = { type: string; children?: Node[]; text?: string };

function rootChildren(state: ReturnType<typeof notesStringToSerializedState>): Node[] {
	return (state.root as unknown as { children: Node[] }).children;
}

describe("notesStringToSerializedState", () => {
	it("yields an empty root for a blank / whitespace-only string", () => {
		expect(rootChildren(notesStringToSerializedState(""))).toEqual([]);
		expect(rootChildren(notesStringToSerializedState("   \n  "))).toEqual([]);
	});

	it("wraps a single line in one paragraph with one text node", () => {
		const children = rootChildren(notesStringToSerializedState("Buy milk"));
		expect(children).toHaveLength(1);
		expect(children[0]?.type).toBe("paragraph");
		expect(children[0]?.children?.[0]).toMatchObject({ type: "text", text: "Buy milk" });
	});

	it("produces one paragraph per line", () => {
		const children = rootChildren(notesStringToSerializedState("first\nsecond\nthird"));
		expect(children).toHaveLength(3);
		expect(children.map((c) => c.children?.[0]?.text)).toEqual(["first", "second", "third"]);
	});

	it("preserves a blank interior line as an empty paragraph", () => {
		const children = rootChildren(notesStringToSerializedState("a\n\nb"));
		expect(children).toHaveLength(3);
		expect(children[1]?.children).toEqual([]);
	});

	it("always shapes a valid Lexical root", () => {
		const state = notesStringToSerializedState("x");
		expect((state.root as unknown as { type: string }).type).toBe("root");
	});
});

describe("hasLegacyNotes", () => {
	it("is true only for a non-blank string", () => {
		expect(hasLegacyNotes("note")).toBe(true);
		expect(hasLegacyNotes("")).toBe(false);
		expect(hasLegacyNotes("   ")).toBe(false);
		expect(hasLegacyNotes(undefined)).toBe(false);
		expect(hasLegacyNotes(null)).toBe(false);
	});
});

describe("shouldClearLegacyNotes", () => {
	it("clears once when notes exist and the task hasn't been migrated", () => {
		expect(shouldClearLegacyNotes("note", false)).toBe(true);
	});

	it("never clears a second time", () => {
		expect(shouldClearLegacyNotes("note", true)).toBe(false);
	});

	it("never clears when there's nothing to carry over", () => {
		expect(shouldClearLegacyNotes("", false)).toBe(false);
		expect(shouldClearLegacyNotes(undefined, false)).toBe(false);
	});
});
