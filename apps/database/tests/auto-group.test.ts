/**
 * Proves the Board/Calendar auto-config that makes view-type switching
 * actually useful (a bare switch leaves groupBy null → blank view).
 */

import { describe, expect, it } from "vitest";
import { autoGroupBy, datePropertyCandidates } from "../src/logic/auto-group";
import type { EntityRow } from "../src/logic/in-memory-entities";

const row = (p: Record<string, unknown>): EntityRow => ({
	id: Math.random().toString(36),
	type: "x/T/v1",
	properties: p,
	createdAt: 0,
	updatedAt: 0,
	deletedAt: null,
});

describe("autoGroupBy", () => {
	it("Board → a status-like low-cardinality string property", () => {
		const rows = [
			row({ name: "a", status: "todo", notes: "long unique text one" }),
			row({ name: "b", status: "doing", notes: "long unique text two" }),
			row({ name: "c", status: "done", notes: "long unique text three" }),
		];
		expect(autoGroupBy(false, rows)).toEqual({ propertyId: "status" });
	});

	it("Calendar → a date/timestamp property, preferring scheduledAt", () => {
		const now = Date.now();
		const rows = [
			row({ name: "a", createdAt: now, scheduledAt: now + 1 }),
			row({ name: "b", createdAt: now, scheduledAt: now + 2 }),
		];
		expect(autoGroupBy(true, rows)).toEqual({ propertyId: "scheduledAt" });
	});

	it("Calendar picks a numeric-timestamp property even if unnamed", () => {
		const t = 1_700_000_000_000;
		expect(autoGroupBy(true, [row({ name: "x", whenMs: t })])).toEqual({ propertyId: "whenMs" });
	});

	it("returns null when nothing suitable exists (so the caller leaves groupBy unset)", () => {
		expect(autoGroupBy(false, [row({ name: "only-a-title" })])).toBeNull();
		expect(autoGroupBy(true, [row({ name: "no dates here" })])).toBeNull();
	});
});

describe("datePropertyCandidates (F-211)", () => {
	it("ranks known scheduling names ahead of inferred timestamp columns", () => {
		const t = 1_700_000_000_000;
		const rows = [row({ name: "a", publishMs: t, dueAt: t + 1 })];
		expect(datePropertyCandidates(rows)).toEqual(["dueAt", "publishMs"]);
	});

	it("a single date-typed property is the only candidate", () => {
		const rows = [row({ name: "a", publishAt: 1_700_000_000_000, status: "open" })];
		expect(datePropertyCandidates(rows)).toEqual(["publishAt"]);
	});

	it("empty for date-less rows", () => {
		expect(datePropertyCandidates([row({ name: "a", status: "open" })])).toEqual([]);
	});
});
