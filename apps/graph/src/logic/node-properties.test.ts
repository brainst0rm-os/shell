import { describe, expect, it } from "vitest";
import type { EntityRow } from "./in-memory-graph";
import { MAX_INSPECTOR_ROWS, humaniseKey, inspectorProperties } from "./node-properties";

function entity(properties: Record<string, unknown>): EntityRow {
	return {
		id: "e1",
		type: "brainstorm/Person/v1",
		properties,
		createdAt: 1,
		updatedAt: 1,
		deletedAt: null,
	} as EntityRow;
}

describe("inspectorProperties (9.13.11 read-only slice)", () => {
	it("formats scalars, joins scalar arrays, and humanises keys", () => {
		const rows = inspectorProperties(
			entity({ city: "Berlin", dueAt: new Date(2026, 5, 9).getTime(), tags: ["a", "b"], done: true }),
		);
		expect(rows.map((r) => r.label)).toEqual(["City", "Due at", "Tags", "Done"]);
		expect(rows[0]?.value).toBe("Berlin");
		expect(rows[1]?.value).toMatch(/2026/);
		expect(rows[2]?.value).toBe("a, b");
		expect(rows[3]?.value).toBe("✓");
	});

	it("skips chrome/blob keys, empties, and non-scalar values", () => {
		const rows = inspectorProperties(
			entity({
				name: "Alice",
				body: { root: {} },
				values: { k: 1 },
				icon: "x",
				note: "",
				meta: { nested: true },
			}),
		);
		expect(rows).toEqual([]);
	});

	it("caps the row count and clips long values", () => {
		const bag: Record<string, unknown> = {};
		for (let i = 0; i < 10; i += 1) bag[`key${i}`] = `v${i}`;
		bag.long = "x".repeat(100);
		const rows = inspectorProperties(entity(bag));
		expect(rows.length).toBe(MAX_INSPECTOR_ROWS);
		const long = inspectorProperties(entity({ long: "x".repeat(100) }))[0];
		expect(long?.value.length).toBeLessThanOrEqual(60);
		expect(long?.value.endsWith("…")).toBe(true);
	});

	it("humanises camelCase / snake_case / kebab-case", () => {
		expect(humaniseKey("dueAt")).toBe("Due at");
		expect(humaniseKey("created_by_user")).toBe("Created by user");
		expect(humaniseKey("color-hint")).toBe("Color hint");
	});

	it("prints non-timestamp numbers verbatim, dates only in the epoch-ms band", () => {
		const rows = inspectorProperties(entity({ count: 42, year: 2026, ts: 1_700_000_000_000 }));
		expect(rows.map((r) => [r.label, r.value])).toEqual([
			["Count", "42"],
			["Year", "2026"],
			["Ts", new Date(1_700_000_000_000).toLocaleDateString()],
		]);
	});

	it("formats ISO date / date-time strings as a local date, leaves prose alone", () => {
		const rows = inspectorProperties(
			entity({
				due: "2026-06-09",
				started: "2026-06-09T14:30:00.000Z",
				note: "2 apples - 3 oranges",
				code: "2026",
			}),
		);
		const byLabel = new Map(rows.map((r) => [r.label, r.value]));
		expect(byLabel.get("Due")).toBe(new Date(Date.parse("2026-06-09")).toLocaleDateString());
		expect(byLabel.get("Started")).toBe(
			new Date(Date.parse("2026-06-09T14:30:00.000Z")).toLocaleDateString(),
		);
		expect(byLabel.get("Note")).toBe("2 apples - 3 oranges");
		expect(byLabel.get("Code")).toBe("2026");
	});

	it("leaves an ISO-shaped but invalid date string verbatim", () => {
		const rows = inspectorProperties(entity({ when: "2026-13-40" }));
		expect(rows).toEqual([{ label: "When", value: "2026-13-40" }]);
	});

	it("keeps scalar members of a mixed array and drops the objects/empties", () => {
		const rows = inspectorProperties(entity({ items: ["keep", { nested: true }, "", 7] }));
		expect(rows).toEqual([{ label: "Items", value: "keep, 7" }]);
	});

	it("drops an array that has no scalar members", () => {
		const rows = inspectorProperties(entity({ refs: [{ id: 1 }, {}] }));
		expect(rows).toEqual([]);
	});
});
