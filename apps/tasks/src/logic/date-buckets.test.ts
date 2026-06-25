import { describe, expect, it } from "vitest";
import { Priority, type Task } from "../types/task";
import { dateKey, endOfToday, groupByScheduledDate, startOfToday } from "./date-buckets";

function task(overrides: Partial<Task> & { id: string; scheduledAt?: number | null }): Task {
	return {
		name: overrides.id,
		completedAt: null,
		priority: Priority.None,
		scheduledAt: overrides.scheduledAt ?? null,
		dueAt: null,
		projectId: null,
		assigneeId: null,
		parentId: null,
		recurrence: null,
		statusKey: null,
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	};
}

function localDay(y: number, m: number, d: number): number {
	return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

function localTime(y: number, m: number, d: number, hh: number, mm: number): number {
	return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

describe("endOfToday", () => {
	it("lifts a mid-day timestamp to 23:59:59.999 on the same local date", () => {
		const noon = localTime(2026, 5, 14, 12, 0);
		const expected = new Date(2026, 4, 14, 23, 59, 59, 999).getTime();
		expect(endOfToday(noon)).toBe(expected);
	});

	it("is idempotent — feeding the result back is a fixed point", () => {
		const noon = localTime(2026, 5, 14, 12, 0);
		const eot = endOfToday(noon);
		expect(endOfToday(eot)).toBe(eot);
	});
});

describe("startOfToday", () => {
	it("anchors to 00:00:00.000 local", () => {
		const noon = localTime(2026, 5, 14, 12, 30);
		expect(startOfToday(noon)).toBe(localDay(2026, 5, 14));
	});
});

describe("dateKey", () => {
	it("emits YYYY-MM-DD in local tz", () => {
		expect(dateKey(localDay(2026, 5, 14))).toBe("2026-05-14");
		expect(dateKey(localTime(2026, 1, 3, 9, 0))).toBe("2026-01-03");
	});
});

describe("groupByScheduledDate", () => {
	it("buckets tasks by local day and sorts ascending", () => {
		const tasks: Task[] = [
			task({ id: "b", scheduledAt: localDay(2026, 5, 16) }),
			task({ id: "a", scheduledAt: localTime(2026, 5, 14, 9, 30) }),
			task({ id: "a2", scheduledAt: localTime(2026, 5, 14, 18, 0) }),
			task({ id: "c", scheduledAt: localDay(2026, 5, 20) }),
		];
		const groups = groupByScheduledDate(tasks);
		expect(groups.map((g) => g.key)).toEqual(["2026-05-14", "2026-05-16", "2026-05-20"]);
		expect(groups[0]?.tasks.map((t) => t.id)).toEqual(["a", "a2"]);
		expect(groups[1]?.tasks.map((t) => t.id)).toEqual(["b"]);
	});

	it("drops tasks without scheduledAt — caller buckets unscheduled separately", () => {
		const groups = groupByScheduledDate([
			task({ id: "u", scheduledAt: null }),
			task({ id: "s", scheduledAt: localDay(2026, 5, 14) }),
		]);
		expect(groups.length).toBe(1);
		expect(groups[0]?.tasks.map((t) => t.id)).toEqual(["s"]);
	});

	it("preserves call-site order within a group (no sort on intra-day tasks)", () => {
		// Caller's responsibility to sort by time / priority / etc inside the group.
		const tasks: Task[] = [
			task({ id: "second", scheduledAt: localTime(2026, 5, 14, 18, 0) }),
			task({ id: "first", scheduledAt: localTime(2026, 5, 14, 9, 0) }),
		];
		expect(groupByScheduledDate(tasks)[0]?.tasks.map((t) => t.id)).toEqual(["second", "first"]);
	});

	it("returns an empty array for no tasks", () => {
		expect(groupByScheduledDate([])).toEqual([]);
	});
});
