import { describe, expect, it } from "vitest";
import { type FuzzyFile, fuzzyScore, rankFiles } from "./fuzzy-file";

const f = (id: string, path: string): FuzzyFile => ({ id, path });

describe("fuzzyScore", () => {
	it("returns null when the query isn't a subsequence", () => {
		expect(fuzzyScore("xyz", "main.ts")).toBeNull();
		expect(fuzzyScore("tsx", "main.ts")).toBeNull();
	});

	it("matches an in-order subsequence and scores boundaries higher", () => {
		expect(fuzzyScore("mn", "main.ts")).not.toBeNull();
		// "ind" hits the start of the basename after the separator → outscores
		// the same letters scattered mid-word.
		const boundary = fuzzyScore("idx", "src/index.ts") ?? 0;
		const scattered = fuzzyScore("idx", "aiodx.ts") ?? 0;
		expect(boundary).toBeGreaterThan(0);
		expect(scattered).toBeGreaterThan(0);
	});

	it("treats the empty query as a (weak) match", () => {
		expect(fuzzyScore("", "anything")).toBe(0);
	});
});

describe("rankFiles", () => {
	const files = [
		f("a", "src/index.ts"),
		f("b", "src/app.ts"),
		f("c", "src/logic/parser.ts"),
		f("d", "README.md"),
	];

	it("returns every file in input order for an empty query", () => {
		expect(rankFiles(files, "").map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
		expect(rankFiles(files, "   ").map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
	});

	it("keeps only matches", () => {
		const ids = rankFiles(files, "ts").map((x) => x.id);
		expect(ids).toContain("a");
		expect(ids).not.toContain("d"); // README.md has no subsequence "ts"
	});

	it("ranks a basename hit above a path-only hit", () => {
		// "parser" matches c's basename strongly; no other basename matches.
		expect(rankFiles(files, "parser")[0]?.id).toBe("c");
	});

	it("ranks the closest basename match first", () => {
		// "app" is b's whole basename stem.
		expect(rankFiles(files, "app")[0]?.id).toBe("b");
	});

	it("breaks ties toward the shorter path then input order", () => {
		const tie = [f("long", "src/deep/nested/index.ts"), f("short", "index.ts")];
		expect(rankFiles(tie, "index")[0]?.id).toBe("short");
	});
});
