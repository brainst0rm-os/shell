import { describe, expect, it } from "vitest";
import type { Whiteboard } from "../types/whiteboard";
import { filterAndSortBoards } from "./board-list";

function board(id: string, name: string, updatedAt: number): Whiteboard {
	return { id, name, nodes: [], createdAt: 0, updatedAt };
}

const BOARDS: Whiteboard[] = [
	board("a", "Roadmap", 30),
	board("b", "Sprint board", 50),
	board("c", "Retro notes", 10),
];

describe("filterAndSortBoards", () => {
	it("returns every board, newest-updated first, for an empty query", () => {
		expect(filterAndSortBoards(BOARDS, "").map((b) => b.id)).toEqual(["b", "a", "c"]);
	});

	it("treats a whitespace-only query as empty", () => {
		expect(filterAndSortBoards(BOARDS, "   ").map((b) => b.id)).toEqual(["b", "a", "c"]);
	});

	it("filters case-insensitively on a name substring, still sorted", () => {
		expect(filterAndSortBoards(BOARDS, "ROAD").map((b) => b.id)).toEqual(["a"]);
		expect(filterAndSortBoards(BOARDS, "o").map((b) => b.id)).toEqual(["b", "a", "c"]);
	});

	it("returns an empty array when nothing matches", () => {
		expect(filterAndSortBoards(BOARDS, "zzz")).toEqual([]);
	});

	it("does not mutate the input array", () => {
		const input = [...BOARDS];
		filterAndSortBoards(input, "");
		expect(input.map((b) => b.id)).toEqual(["a", "b", "c"]);
	});
});
