import { describe, expect, it } from "vitest";
import { Priority, type Task } from "../types/task";
import {
	addDays,
	compileGantt,
	dayStart,
	estimateDays,
	ganttSpan,
	nextDayStart,
	prevDayStart,
	rangeDays,
} from "./gantt";

/** Local noon on a fixed date — away from any midnight/DST edge. */
const NOW = new Date(2026, 5, 10, 12, 0, 0).getTime();
const TODAY = dayStart(NOW);

function task(id: string, overrides: Partial<Task> = {}): Task {
	return {
		id,
		name: id,
		completedAt: null,
		priority: Priority.None,
		scheduledAt: null,
		dueAt: null,
		projectId: null,
		assigneeId: null,
		parentId: null,
		recurrence: null,
		statusKey: null,
		createdAt: NOW - 1000,
		updatedAt: NOW - 1000,
		...overrides,
	};
}

describe("day walking", () => {
	it("nextDayStart / prevDayStart round-trip", () => {
		const next = nextDayStart(TODAY);
		expect(next).toBeGreaterThan(TODAY);
		expect(prevDayStart(next)).toBe(TODAY);
	});

	it("addDays walks calendar days", () => {
		expect(addDays(TODAY, 0)).toBe(TODAY);
		expect(addDays(TODAY, 3)).toBe(nextDayStart(nextDayStart(nextDayStart(TODAY))));
	});
});

describe("estimateDays", () => {
	it("sub-day estimates keep the one-day minimum", () => {
		expect(estimateDays(undefined)).toBe(1);
		expect(estimateDays(0)).toBe(1);
		expect(estimateDays(120)).toBe(1);
	});

	it("multi-day effort widens the bar", () => {
		expect(estimateDays(24 * 60)).toBe(1);
		expect(estimateDays(24 * 60 + 1)).toBe(2);
		expect(estimateDays(3 * 24 * 60)).toBe(3);
	});
});

describe("ganttSpan", () => {
	it("dateless task has no span", () => {
		expect(ganttSpan(task("a"))).toBeNull();
	});

	it("scheduled-only paints estimate-many days from the scheduled day", () => {
		const span = ganttSpan(task("a", { scheduledAt: NOW, estimateMinutes: 2 * 24 * 60 }));
		expect(span).toEqual({ startMs: TODAY, endMs: addDays(TODAY, 2), derivedStart: false });
	});

	it("scheduled + due paints through the due day", () => {
		const due = addDays(TODAY, 3) + 1000;
		const span = ganttSpan(task("a", { scheduledAt: NOW, dueAt: due }));
		expect(span).toEqual({ startMs: TODAY, endMs: addDays(TODAY, 4), derivedStart: false });
	});

	it("due before scheduled still paints the scheduled day", () => {
		const span = ganttSpan(task("a", { scheduledAt: NOW, dueAt: NOW - 5 * 24 * 60 * 60 * 1000 }));
		expect(span).toEqual({ startMs: TODAY, endMs: nextDayStart(TODAY), derivedStart: false });
	});

	it("due-only derives the start backward from the due day", () => {
		const span = ganttSpan(task("a", { dueAt: NOW, estimateMinutes: 2 * 24 * 60 }));
		expect(span).toEqual({
			startMs: prevDayStart(TODAY),
			endMs: nextDayStart(TODAY),
			derivedStart: true,
		});
	});
});

describe("compileGantt", () => {
	it("counts dateless tasks instead of drawing them", () => {
		const model = compileGantt([task("a"), task("b", { scheduledAt: NOW })], NOW);
		expect(model.rows.map((r) => r.task.id)).toEqual(["b"]);
		expect(model.unscheduledCount).toBe(1);
	});

	it("excludes subtasks (they roll up under their parent)", () => {
		const parent = task("p", { scheduledAt: NOW });
		const child = task("c", { scheduledAt: NOW, parentId: "p" });
		const model = compileGantt([parent, child], NOW);
		expect(model.rows.map((r) => r.task.id)).toEqual(["p"]);
	});

	it("sorts lanes chronologically", () => {
		const later = task("later", { scheduledAt: addDays(TODAY, 5) });
		const earlier = task("earlier", { scheduledAt: prevDayStart(TODAY) });
		const model = compileGantt([later, earlier], NOW);
		expect(model.rows.map((r) => r.task.id)).toEqual(["earlier", "later"]);
	});

	it("maps dependsOn to lane edges and flags open blockers", () => {
		const dep = task("dep", { scheduledAt: prevDayStart(TODAY) });
		const dependent = task("dependent", { scheduledAt: NOW, dependsOn: ["dep", "missing"] });
		const model = compileGantt([dep, dependent], NOW);
		expect(model.edges).toEqual([{ fromIndex: 0, toIndex: 1 }]);
		expect(model.rows[1]?.blocked).toBe(true);
	});

	it("a completed dependency neither blocks nor loses its edge", () => {
		const dep = task("dep", { scheduledAt: prevDayStart(TODAY), completedAt: NOW });
		const dependent = task("dependent", { scheduledAt: NOW, dependsOn: ["dep"] });
		const model = compileGantt([dep, dependent], NOW);
		expect(model.edges).toHaveLength(1);
		expect(model.rows[1]?.blocked).toBe(false);
	});

	it("a filtered-out blocker still blocks when allTasks carries it", () => {
		const blocker = task("blocker", { scheduledAt: NOW });
		const dependent = task("dependent", { scheduledAt: NOW, dependsOn: ["blocker"] });
		// `dependent` is the only VISIBLE task (e.g. a tag filter hid the
		// blocker) — blocking must still be judged against the full set.
		const model = compileGantt([dependent], NOW, [blocker, dependent]);
		expect(model.rows[0]?.blocked).toBe(true);
	});

	it("an unscheduled blocker still marks its dependent blocked", () => {
		const blocker = task("blocker");
		const dependent = task("dependent", { scheduledAt: NOW, dependsOn: ["blocker"] });
		const model = compileGantt([blocker, dependent], NOW);
		expect(model.rows.map((r) => r.task.id)).toEqual(["dependent"]);
		expect(model.edges).toEqual([]);
		expect(model.rows[0]?.blocked).toBe(true);
	});

	it("range pads the data and always contains today", () => {
		const far = task("far", { scheduledAt: addDays(TODAY, 10) });
		const model = compileGantt([far], NOW);
		expect(model.rangeStartMs).toBe(prevDayStart(TODAY));
		expect(model.rangeEndMs).toBe(addDays(addDays(TODAY, 11), 2));
	});

	it("rangeDays is index-aligned and covers the whole range", () => {
		const model = compileGantt([task("a", { scheduledAt: NOW })], NOW);
		const days = rangeDays(model);
		expect(days[0]).toBe(model.rangeStartMs);
		expect(days.at(-1)).toBe(prevDayStart(model.rangeEndMs));
		for (let i = 1; i < days.length; i += 1) {
			expect(days[i]).toBe(nextDayStart(days[i - 1] ?? 0));
		}
	});
});
