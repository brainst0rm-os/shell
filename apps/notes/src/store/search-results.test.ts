import { describe, expect, it } from "vitest";
import type { StoredNote } from "./note";
import { localNoteOrder, noteSearchOrder } from "./search-results";

function note(over: Partial<StoredNote> & { id: string }): StoredNote {
	return {
		id: over.id,
		title: over.title ?? "",
		body: over.body ?? "",
		icon: over.icon ?? null,
		createdAt: over.createdAt ?? 0,
		updatedAt: over.updatedAt ?? 0,
	} as StoredNote;
}

function asMap(list: StoredNote[]): Map<string, StoredNote> {
	return new Map(list.map((n) => [n.id, n]));
}

describe("noteSearchOrder", () => {
	it("returns ids in hit (rank) order", () => {
		const notes = asMap([note({ id: "a" }), note({ id: "b" }), note({ id: "c" })]);
		expect(noteSearchOrder(notes, [{ entityId: "c" }, { entityId: "a" }])).toEqual(["c", "a"]);
	});

	it("skips hit ids the in-memory map no longer has", () => {
		const notes = asMap([note({ id: "a" })]);
		expect(noteSearchOrder(notes, [{ entityId: "gone" }, { entityId: "a" }])).toEqual(["a"]);
	});

	it("empty hits → []", () => {
		expect(noteSearchOrder(asMap([note({ id: "a" })]), [])).toEqual([]);
	});
});

describe("localNoteOrder", () => {
	it("matches title or plain body, newest first", () => {
		const notes = asMap([
			note({ id: "old", title: "Milk run", updatedAt: 1 }),
			note({ id: "new", title: "Groceries", body: "buy milk and eggs", updatedAt: 5 }),
			note({ id: "x", title: "Unrelated", updatedAt: 9 }),
		]);
		expect(localNoteOrder(notes, "MILK")).toEqual(["new", "old"]);
	});

	it("empty / whitespace → []", () => {
		const notes = asMap([note({ id: "a", title: "anything" })]);
		expect(localNoteOrder(notes, "")).toEqual([]);
		expect(localNoteOrder(notes, "  ")).toEqual([]);
	});
});
