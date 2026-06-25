import { describe, expect, it } from "vitest";
import { customPropertyRows, formatPropertyValue, humanizeKey } from "./property-rows";

describe("humanizeKey", () => {
	it("title-cases a single lowercase word", () => {
		expect(humanizeKey("status")).toBe("Status");
	});

	it("splits camelCase before title-casing", () => {
		expect(humanizeKey("startDate")).toBe("Start date");
	});

	it("splits snake_case before title-casing", () => {
		expect(humanizeKey("due_date")).toBe("Due date");
	});

	it("applies acronym overrides", () => {
		expect(humanizeKey("url")).toBe("URL");
	});
});

describe("formatPropertyValue", () => {
	it("passes a non-empty string through", () => {
		expect(formatPropertyValue("done")).toBe("done");
	});

	it("renders numbers", () => {
		expect(formatPropertyValue(42)).toBe("42");
	});

	it("renders booleans as glyphs", () => {
		expect(formatPropertyValue(true)).toBe("✓");
		expect(formatPropertyValue(false)).toBe("✕");
	});

	it("joins arrays of scalars", () => {
		expect(formatPropertyValue(["a", "b", "c"])).toBe("a, b, c");
	});

	it("returns null for empty / non-legible values", () => {
		expect(formatPropertyValue("")).toBeNull();
		expect(formatPropertyValue(null)).toBeNull();
		expect(formatPropertyValue(undefined)).toBeNull();
		expect(formatPropertyValue([])).toBeNull();
		expect(formatPropertyValue({})).toBeNull();
	});

	it("renders a nested object as a compact key list", () => {
		expect(formatPropertyValue({ width: 100, height: 200 })).toBe("{ width, height }");
	});

	it("renders an array of objects via the compact form", () => {
		expect(formatPropertyValue([{ a: 1 }, { b: 2 }])).toBe("{ a }, { b }");
	});
});

describe("customPropertyRows", () => {
	it("enumerates user-defined properties not rendered elsewhere", () => {
		const rows = customPropertyRows({
			name: "Report.pdf",
			mime: "application/pdf",
			size: 2048,
			status: "approved",
			reviewedBy: "Mira",
		});
		expect(rows).toEqual([
			{ key: "reviewedBy", label: "Reviewed by", value: "Mira" },
			{ key: "status", label: "Status", value: "approved" },
		]);
	});

	it("skips system / already-rendered keys (case-insensitively)", () => {
		const rows = customPropertyRows({
			name: "x",
			description: "y",
			members: ["a"],
			icon: "📁",
			cover: { kind: "solid" },
			createdAt: 1,
			updatedAt: 2,
			id: "z",
			type: "brainstorm/Folder/v1",
		});
		expect(rows).toEqual([]);
	});

	it("skips properties whose value is not legible", () => {
		const rows = customPropertyRows({ empty: "", blank: null, hollow: {} });
		expect(rows).toEqual([]);
	});

	it("renders array and boolean custom properties", () => {
		const rows = customPropertyRows({ tags: ["q3", "finance"], archived: true });
		expect(rows).toContainEqual({ key: "tags", label: "Tags", value: "q3, finance" });
		expect(rows).toContainEqual({ key: "archived", label: "Archived", value: "✓" });
	});

	it("renders an object-valued custom property instead of dropping it", () => {
		const rows = customPropertyRows({ dimensions: { width: 100, height: 200 } });
		expect(rows).toContainEqual({
			key: "dimensions",
			label: "Dimensions",
			value: "{ width, height }",
		});
	});

	it("excludes custom keys that humanize to a system label", () => {
		const rows = customPropertyRows({ created: "spoof", modified: "spoof" });
		expect(rows).toEqual([]);
	});

	it("keeps a custom key distinct from a system row when labels collide", () => {
		// A custom property whose key is unrelated to the system metadata but
		// happens to humanize to the same label as a system row must still be
		// enumerated — the inspector keys rows by index, not label, so both
		// render distinctly.
		const rows = customPropertyRows({ reviewStatus: "approved" });
		const labels = rows.map((row) => row.label);
		expect(labels).toEqual(["Review status"]);
		expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
	});
});
