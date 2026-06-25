import { describe, expect, it } from "vitest";
import { bulkRenameName, bulkRenamePlan, bulkRenamePlanAvoiding } from "./bulk-rename";

describe("bulk rename (9.8.12)", () => {
	it("numbers from 1 and preserves each item's extension", () => {
		expect(bulkRenamePlan("Report", ["a.png", "b.pdf", "notes"])).toEqual([
			"Report 1.png",
			"Report 2.pdf",
			"Report 3",
		]);
	});

	it("treats a leading dot as a hidden-file name, not an extension", () => {
		expect(bulkRenameName("Config", 0, ".gitignore")).toBe("Config 1");
	});

	it("rejects junk extensions (too long / spaces)", () => {
		expect(bulkRenameName("X", 0, "weird.this is not an ext")).toBe("X 1");
		expect(bulkRenameName("X", 0, "archive.backup2026full")).toBe("X 1");
	});
});

describe("bulk rename collision avoidance (BUG 3 — untouched siblings)", () => {
	it("with no taken siblings it matches the plain plan", () => {
		expect(bulkRenamePlanAvoiding("Report", ["a.png", "b.pdf"], new Set())).toEqual([
			"Report 1.png",
			"Report 2.pdf",
		]);
	});

	it("steps past a name already taken by a non-selected sibling", () => {
		// "Report 1.png" already exists in the folder (not selected); the first
		// renamed item must become "Report 2.png" to avoid clobbering it.
		const plan = bulkRenamePlanAvoiding("Report", ["x.png", "y.png"], new Set(["Report 1.png"]));
		expect(plan).toEqual(["Report 2.png", "Report 3.png"]);
	});

	it("skips multiple occupied numbers", () => {
		const plan = bulkRenamePlanAvoiding(
			"Doc",
			["a.txt", "b.txt"],
			new Set(["Doc 1.txt", "Doc 2.txt", "Doc 4.txt"]),
		);
		expect(plan).toEqual(["Doc 3.txt", "Doc 5.txt"]);
	});

	it("collision is extension-specific (same number, different ext is free)", () => {
		const plan = bulkRenamePlanAvoiding("Mix", ["a.png", "b.pdf"], new Set(["Mix 1.pdf"]));
		// "Mix 1.png" is free; "Mix 1.pdf" is taken so the .pdf item bumps.
		expect(plan).toEqual(["Mix 1.png", "Mix 2.pdf"]);
	});

	it("never assigns two selection members the same name", () => {
		const plan = bulkRenamePlanAvoiding("F", ["a.txt", "b.txt", "c.txt"], new Set(["F 2.txt"]));
		expect(new Set(plan).size).toBe(plan.length);
		expect(plan).toEqual(["F 1.txt", "F 3.txt", "F 4.txt"]);
	});
});
