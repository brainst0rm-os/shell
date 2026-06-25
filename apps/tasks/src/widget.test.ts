import { describe, expect, it } from "vitest";
import { computeTaskStats } from "./widget-stats";

/** A fixed local-noon anchor so the day-window math is stable across runs. */
const NOW = new Date(2026, 5, 21, 12, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

describe("computeTaskStats", () => {
	it("counts every open task and points the primary at the most recent", () => {
		const stats = computeTaskStats(
			[
				{ id: "a", updatedAt: 10, dueAt: null },
				{ id: "b", updatedAt: 30, dueAt: null },
				{ id: "c", updatedAt: 20, dueAt: null },
			],
			NOW,
		);
		expect(stats.open.count).toBe(3);
		expect(stats.open.topId).toBe("b");
	});

	it("buckets overdue (due before today) and opens the most overdue", () => {
		const stats = computeTaskStats(
			[
				{ id: "old", updatedAt: 1, dueAt: NOW - 3 * DAY },
				{ id: "older", updatedAt: 1, dueAt: NOW - 5 * DAY },
			],
			NOW,
		);
		expect(stats.overdue.count).toBe(2);
		expect(stats.overdue.topId).toBe("older");
	});

	it("buckets due-today (within the local day) and opens the earliest", () => {
		const dayStart = new Date(2026, 5, 21, 0, 0, 0).getTime();
		const stats = computeTaskStats(
			[
				{ id: "noon", updatedAt: 1, dueAt: dayStart + 12 * 60 * 60 * 1000 },
				{ id: "morning", updatedAt: 1, dueAt: dayStart + 9 * 60 * 60 * 1000 },
			],
			NOW,
		);
		expect(stats.dueToday.count).toBe(2);
		expect(stats.dueToday.topId).toBe("morning");
	});

	it("excludes future-dated tasks from both overdue and due-today", () => {
		const stats = computeTaskStats([{ id: "future", updatedAt: 1, dueAt: NOW + 3 * DAY }], NOW);
		expect(stats.open.count).toBe(1);
		expect(stats.overdue.count).toBe(0);
		expect(stats.dueToday.count).toBe(0);
	});

	it("yields empty buckets (null topIds) for no tasks", () => {
		const stats = computeTaskStats([], NOW);
		expect(stats.open).toEqual({ count: 0, topId: null });
		expect(stats.overdue).toEqual({ count: 0, topId: null });
		expect(stats.dueToday).toEqual({ count: 0, topId: null });
	});
});
