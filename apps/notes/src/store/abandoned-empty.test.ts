import { describe, expect, it } from "vitest";
import type { StoredNote } from "./note";
import { isAbandonedEmpty, shouldDiscardAbandoned } from "./use-notes";

function makeNote(patch: Partial<StoredNote> = {}): StoredNote {
	return {
		id: "n_1",
		title: "",
		icon: null,
		cover: null,
		body: "",
		values: {},
		createdAt: 0,
		updatedAt: 0,
		...patch,
	};
}

describe("isAbandonedEmpty (F-066 auto-discard guard)", () => {
	it("is true for a freshly-created note with nothing authored", () => {
		expect(isAbandonedEmpty(makeNote())).toBe(true);
		// Whitespace-only title/body still counts as empty.
		expect(isAbandonedEmpty(makeNote({ title: "  ", body: "\n" }))).toBe(true);
	});

	it("is false the moment the user adds any content", () => {
		expect(isAbandonedEmpty(makeNote({ title: "Draft" }))).toBe(false);
		expect(isAbandonedEmpty(makeNote({ body: "a thought" }))).toBe(false);
		expect(isAbandonedEmpty(makeNote({ icon: { kind: "emoji", value: "📝" } as never }))).toBe(false);
		expect(isAbandonedEmpty(makeNote({ cover: { kind: "color", value: "#fff" } as never }))).toBe(
			false,
		);
		expect(isAbandonedEmpty(makeNote({ values: { status: "open" } as never }))).toBe(false);
	});
});

describe("shouldDiscardAbandoned (F-196 leave-Notes discard)", () => {
	const session = new Set(["n_1"]);
	const empty = new Map([["n_1", makeNote()]]);

	it("discards a session-created empty note left selected (the window-close ghost)", () => {
		expect(shouldDiscardAbandoned("n_1", session, empty)).toBe(true);
	});

	it("never discards a note not created this session (pre-existing blanks are kept)", () => {
		expect(shouldDiscardAbandoned("n_1", new Set(), empty)).toBe(false);
	});

	it("never discards once any content was authored", () => {
		const authored = new Map([["n_1", makeNote({ title: "Team — who owns what" })]]);
		expect(shouldDiscardAbandoned("n_1", session, authored)).toBe(false);
	});

	it("is a no-op for a null selection or an unknown id", () => {
		expect(shouldDiscardAbandoned(null, session, empty)).toBe(false);
		expect(shouldDiscardAbandoned("n_missing", session, empty)).toBe(false);
	});
});
