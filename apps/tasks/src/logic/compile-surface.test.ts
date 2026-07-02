import { describe, expect, it } from "vitest";
import { TaskSurface, UpcomingGrouping } from "../types/surface";
import { Priority, type Task } from "../types/task";
import { compileSurface } from "./compile-surface";
import { TaskSort } from "./task-sort";

const DAY = 86_400_000;
const NOW = new Date(2026, 4, 14, 10, 0, 0, 0).getTime(); // 2026-05-14 10:00 local

function task(overrides: Partial<Task> & { id: string; name?: string }): Task {
	return {
		name: overrides.name ?? overrides.id,
		completedAt: null,
		priority: Priority.None,
		scheduledAt: null,
		dueAt: null,
		projectId: null,
		assigneeId: null,
		parentId: null,
		recurrence: null,
		statusKey: null,
		createdAt: NOW - 7 * DAY,
		updatedAt: NOW - 1 * DAY,
		...overrides,
	};
}

describe("compileSurface — Inbox", () => {
	it("includes only unscheduled, unprojected, open tasks", () => {
		const tasks: Task[] = [
			task({ id: "i1" }),
			task({ id: "i2" }),
			task({ id: "scheduled", scheduledAt: NOW + DAY }),
			task({ id: "projected", projectId: "proj_a" }),
			task({ id: "done", completedAt: NOW - DAY }),
		];
		const result = compileSurface(tasks, TaskSurface.Inbox, { now: NOW });
		expect(result.surface).toBe(TaskSurface.Inbox);
		expect(result.sections.length).toBe(1);
		expect(result.sections[0]?.tasks.map((t) => t.id)).toEqual(["i1", "i2"]);
		expect(result.count).toBe(2);
	});

	it("sorts open tasks by priority desc then createdAt asc", () => {
		const tasks: Task[] = [
			task({ id: "low_old", priority: Priority.Low, createdAt: NOW - 10 * DAY }),
			task({ id: "crit_new", priority: Priority.Critical, createdAt: NOW - 1 * DAY }),
			task({ id: "none_mid", priority: Priority.None, createdAt: NOW - 5 * DAY }),
			task({ id: "crit_old", priority: Priority.Critical, createdAt: NOW - 8 * DAY }),
		];
		const result = compileSurface(tasks, TaskSurface.Inbox, { now: NOW });
		expect(result.sections[0]?.tasks.map((t) => t.id)).toEqual([
			"crit_old",
			"crit_new",
			"low_old",
			"none_mid",
		]);
	});

	it("respects showCompleted — done tasks land at the bottom in completedAt desc", () => {
		const tasks: Task[] = [
			task({ id: "open" }),
			task({ id: "done_old", completedAt: NOW - 5 * DAY }),
			task({ id: "done_new", completedAt: NOW - 1 * DAY }),
		];
		const result = compileSurface(tasks, TaskSurface.Inbox, {
			now: NOW,
			showCompleted: true,
		});
		expect(result.sections[0]?.tasks.map((t) => t.id)).toEqual(["open", "done_new", "done_old"]);
	});
});

describe("compileSurface — Today", () => {
	it("splits Overdue + Today sections; overdue only present when non-empty", () => {
		const tasks: Task[] = [
			task({ id: "today1", scheduledAt: NOW + 2 * 3_600_000 }),
			task({ id: "today2", scheduledAt: NOW - 2 * 3_600_000 }),
			task({ id: "overdue", dueAt: NOW - DAY }),
		];
		const result = compileSurface(tasks, TaskSurface.Today, { now: NOW });
		expect(result.sections.map((s) => s.key)).toEqual(["today.overdue", "today.today"]);
		expect(result.sections[0]?.tasks.map((t) => t.id)).toEqual(["overdue"]);
		expect(result.sections[1]?.tasks.map((t) => t.id)).toEqual(["today2", "today1"]);
		expect(result.count).toBe(3);
	});

	it("omits Overdue section when nothing overdue", () => {
		const tasks: Task[] = [task({ id: "today", scheduledAt: NOW })];
		const result = compileSurface(tasks, TaskSurface.Today, { now: NOW });
		expect(result.sections.map((s) => s.key)).toEqual(["today.today"]);
	});

	it("omits the empty Today section when everything is overdue (no bare header)", () => {
		// Regression for the "OVERDUE · 6 then a bare TODAY header with no rows"
		// defect: a Today view with overdue tasks but nothing due today must not
		// emit the today.today section — an empty group header reads as broken.
		const tasks: Task[] = [
			task({ id: "od1", dueAt: NOW - DAY }),
			task({ id: "od2", dueAt: NOW - 2 * DAY }),
		];
		const result = compileSurface(tasks, TaskSurface.Today, { now: NOW });
		expect(result.sections.map((s) => s.key)).toEqual(["today.overdue"]);
		expect(result.count).toBe(2);
	});

	it("an open task scheduled for a past day is Overdue, not Today (no silent roll-over into Today)", () => {
		const tasks: Task[] = [
			// Scheduled days ago, still open, no due date — must surface as Overdue.
			task({ id: "pastScheduled", scheduledAt: NOW - 3 * DAY }),
			// Scheduled earlier *today* (2h ago) — still belongs to Today.
			task({ id: "earlierToday", scheduledAt: NOW - 2 * 3_600_000 }),
			// Scheduled for later today.
			task({ id: "laterToday", scheduledAt: NOW + 2 * 3_600_000 }),
		];
		const result = compileSurface(tasks, TaskSurface.Today, { now: NOW });
		expect(result.sections.map((s) => s.key)).toEqual(["today.overdue", "today.today"]);
		expect(result.sections[0]?.tasks.map((t) => t.id)).toEqual(["pastScheduled"]);
		expect(result.sections[1]?.tasks.map((t) => t.id)).toEqual(["earlierToday", "laterToday"]);
		expect(result.sections[0]?.titleParams).toEqual({ count: 1 });
	});

	it("a task with projectId still appears in Today if overdue (overdue cuts through project routing)", () => {
		const tasks: Task[] = [task({ id: "overdueProj", projectId: "p", dueAt: NOW - DAY })];
		const result = compileSurface(tasks, TaskSurface.Today, { now: NOW });
		expect(result.sections[0]?.tasks.map((t) => t.id)).toEqual(["overdueProj"]);
	});

	it("a project-bound task scheduled today appears in Today (date-driven, not no-project)", () => {
		// Regression for the empty-Today bug: every seeded plan iteration
		// has `projectId = proj-<stage>`, so the earlier "Project takes
		// precedence" routing in `surfaceFor` left Today empty even when
		// scheduled today. Today is now a date view; the Project surface
		// continues to group the same tasks under their stage.
		const tasks: Task[] = [
			task({ id: "freeToday", scheduledAt: NOW }),
			task({ id: "projToday", projectId: "proj-9", scheduledAt: NOW }),
			task({ id: "projTomorrow", projectId: "proj-9", scheduledAt: NOW + DAY }),
		];
		const result = compileSurface(tasks, TaskSurface.Today, { now: NOW });
		expect(result.sections[0]?.tasks.map((t) => t.id).sort()).toEqual(["freeToday", "projToday"]);
	});

	it("excludes done tasks by default; includes them when showCompleted=true", () => {
		const tasks: Task[] = [
			task({ id: "open", scheduledAt: NOW }),
			task({ id: "done", scheduledAt: NOW, completedAt: NOW - 1000 }),
		];
		const closed = compileSurface(tasks, TaskSurface.Today, { now: NOW });
		expect(closed.sections[0]?.tasks.map((t) => t.id)).toEqual(["open"]);

		const open = compileSurface(tasks, TaskSurface.Today, {
			now: NOW,
			showCompleted: true,
		});
		expect(open.sections[0]?.tasks.map((t) => t.id)).toEqual(["open", "done"]);
	});

	it("with showCompleted, Today includes only tasks completed today — not the whole backlog of past-finished work", () => {
		const tasks: Task[] = [
			task({ id: "openToday", scheduledAt: NOW }),
			// Finished earlier today, though scheduled two days ago.
			task({ id: "doneToday", scheduledAt: NOW - 2 * DAY, completedAt: NOW - 2 * 3_600_000 }),
			// Finished a month ago — must NOT surface in Today.
			task({ id: "doneLongAgo", scheduledAt: NOW - 30 * DAY, completedAt: NOW - 30 * DAY }),
		];
		const result = compileSurface(tasks, TaskSurface.Today, { now: NOW, showCompleted: true });
		const ids = result.sections.flatMap((s) => s.tasks.map((t) => t.id));
		expect(ids).toContain("openToday");
		expect(ids).toContain("doneToday");
		expect(ids).not.toContain("doneLongAgo");
	});
});

describe("compileSurface — Upcoming", () => {
	it("date-groups scheduled tasks strictly after end-of-today", () => {
		const tasks: Task[] = [
			task({ id: "today", scheduledAt: NOW + 1 * 3_600_000 }), // today, excluded
			task({ id: "tomorrow", scheduledAt: NOW + 1 * DAY }),
			task({ id: "tomorrow2", scheduledAt: NOW + 1 * DAY + 5 * 3_600_000 }),
			task({ id: "in5days", scheduledAt: NOW + 5 * DAY }),
		];
		const result = compileSurface(tasks, TaskSurface.Upcoming, { now: NOW });
		expect(result.sections.length).toBe(2);
		// Day 1 group first (sorted ascending by date).
		expect(result.sections[0]?.tasks.map((t) => t.id)).toEqual(["tomorrow", "tomorrow2"]);
		expect(result.sections[1]?.tasks.map((t) => t.id)).toEqual(["in5days"]);
	});

	it("includes project-bound tasks alongside free-floating ones (Upcoming is date-driven, project surface coexists)", () => {
		// Pre-2026-05-24 behavior excluded project-bound tasks here, which
		// emptied Upcoming for any plan-seeded vault (every iteration
		// belongs to its stage's `proj-N`). Upcoming now mirrors the
		// canonical "what's scheduled when" view; the Project surface
		// still groups the same tasks under their stage.
		const tasks: Task[] = [
			task({ id: "free", scheduledAt: NOW + 2 * DAY }),
			task({ id: "owned", scheduledAt: NOW + 2 * DAY, projectId: "p" }),
		];
		const result = compileSurface(tasks, TaskSurface.Upcoming, { now: NOW });
		expect(result.sections[0]?.tasks.map((t) => t.id).sort()).toEqual(["free", "owned"]);
	});

	it("returns an empty section list when no upcoming tasks", () => {
		const result = compileSurface([], TaskSurface.Upcoming, { now: NOW });
		expect(result.sections).toEqual([]);
		expect(result.count).toBe(0);
	});
});

describe("compileSurface — Upcoming grouped by assignee (F-164)", () => {
	const NAMES: Record<string, string> = {
		"person-priya": "Priya",
		"person-marcus": "Marcus",
	};
	const assigneeName = (id: string): string | null => NAMES[id] ?? null;
	const byAssignee = (tasks: Task[]) =>
		compileSurface(tasks, TaskSurface.Upcoming, {
			now: NOW,
			upcomingGrouping: UpcomingGrouping.Assignee,
			assigneeName,
		});

	it("groups the same date-scoped task set per assignee, Unassigned last", () => {
		const tasks: Task[] = [
			task({ id: "today", scheduledAt: NOW + 3_600_000, assigneeId: "person-priya" }), // not upcoming
			task({ id: "p1", scheduledAt: NOW + 1 * DAY, assigneeId: "person-priya" }),
			task({ id: "p2", scheduledAt: NOW + 3 * DAY, assigneeId: "person-priya" }),
			task({ id: "m1", scheduledAt: NOW + 2 * DAY, assigneeId: "person-marcus" }),
			task({ id: "nobody", scheduledAt: NOW + 2 * DAY }),
		];
		const result = byAssignee(tasks);
		expect(result.sections.map((s) => s.key)).toEqual([
			"upcoming.assignee.person-marcus",
			"upcoming.assignee.person-priya",
			"upcoming.unassigned",
		]);
		expect(result.sections[1]?.tasks.map((t) => t.id)).toEqual(["p1", "p2"]);
		expect(result.count).toBe(4);
	});

	it("titles named sections with the resolved display name, sorted ascending", () => {
		const tasks: Task[] = [
			task({ id: "p", scheduledAt: NOW + DAY, assigneeId: "person-priya" }),
			task({ id: "m", scheduledAt: NOW + DAY, assigneeId: "person-marcus" }),
		];
		const result = byAssignee(tasks);
		expect(result.sections[0]?.titleKey).toBe("tasks.section.assignee");
		expect(result.sections[0]?.titleParams).toEqual({ name: "Marcus" });
		expect(result.sections[1]?.titleParams).toEqual({ name: "Priya" });
	});

	it("titles the unassigned bucket with the Unassigned key", () => {
		const result = byAssignee([task({ id: "loose", scheduledAt: NOW + DAY })]);
		expect(result.sections).toHaveLength(1);
		expect(result.sections[0]?.key).toBe("upcoming.unassigned");
		expect(result.sections[0]?.titleKey).toBe("tasks.section.unassigned");
	});

	it("falls back to the unknown-person heading when the resolver misses, after named sections", () => {
		const tasks: Task[] = [
			task({ id: "g", scheduledAt: NOW + DAY, assigneeId: "person-ghost" }),
			task({ id: "p", scheduledAt: NOW + DAY, assigneeId: "person-priya" }),
		];
		const result = byAssignee(tasks);
		expect(result.sections.map((s) => s.key)).toEqual([
			"upcoming.assignee.person-priya",
			"upcoming.assignee.person-ghost",
		]);
		expect(result.sections[1]?.titleKey).toBe("tasks.assignee.unknown");
		expect(result.sections[1]?.titleParams).toBeUndefined();
	});

	it("sorts within a person's section by due/scheduled ascending", () => {
		const tasks: Task[] = [
			task({ id: "later", scheduledAt: NOW + 4 * DAY, assigneeId: "person-priya" }),
			task({ id: "soon", scheduledAt: NOW + 1 * DAY, assigneeId: "person-priya" }),
			task({
				id: "due-first",
				scheduledAt: NOW + 3 * DAY,
				dueAt: NOW + 12 * 3_600_000,
				assigneeId: "person-priya",
			}),
		];
		const result = byAssignee(tasks);
		expect(result.sections[0]?.tasks.map((t) => t.id)).toEqual(["due-first", "soon", "later"]);
	});

	it("keeps the chronological date grouping when no grouping option is passed", () => {
		const tasks: Task[] = [
			task({ id: "a", scheduledAt: NOW + 1 * DAY, assigneeId: "person-priya" }),
			task({ id: "b", scheduledAt: NOW + 2 * DAY, assigneeId: "person-marcus" }),
		];
		const result = compileSurface(tasks, TaskSurface.Upcoming, { now: NOW });
		expect(result.sections.map((s) => s.key)).toEqual(["upcoming.2026-05-15", "upcoming.2026-05-16"]);
	});
});

describe("compileSurface — Upcoming grouped by arbitrary axes", () => {
	const groupLabel = (grouping: UpcomingGrouping, key: string): string => {
		if (grouping === UpcomingGrouping.Project) return `Project ${key.toUpperCase()}`;
		if (grouping === UpcomingGrouping.Status) return key === "todo" ? "To-do" : "Done";
		if (grouping === UpcomingGrouping.Priority) return key;
		return key;
	};
	const by = (grouping: UpcomingGrouping, tasks: Task[]) =>
		compileSurface(tasks, TaskSurface.Upcoming, { now: NOW, upcomingGrouping: grouping, groupLabel });

	it("groups by priority with Critical first, sharing the same date-scoped set", () => {
		const tasks: Task[] = [
			task({ id: "soon", scheduledAt: NOW + 3_600_000, priority: Priority.Critical }), // not upcoming
			task({ id: "low", scheduledAt: NOW + 1 * DAY, priority: Priority.Low }),
			task({ id: "crit", scheduledAt: NOW + 2 * DAY, priority: Priority.Critical }),
			task({ id: "med", scheduledAt: NOW + 3 * DAY, priority: Priority.Medium }),
		];
		const result = by(UpcomingGrouping.Priority, tasks);
		expect(result.sections.map((s) => s.key)).toEqual([
			"upcoming.priority.critical",
			"upcoming.priority.medium",
			"upcoming.priority.low",
		]);
		expect(result.sections[0]?.title).toBe("critical");
		expect(result.count).toBe(3);
	});

	it("groups by project with the resolved name, no-project bucket last", () => {
		const tasks: Task[] = [
			task({ id: "a", scheduledAt: NOW + 1 * DAY, projectId: "p_b" }),
			task({ id: "b", scheduledAt: NOW + 1 * DAY, projectId: "p_a" }),
			task({ id: "loose", scheduledAt: NOW + 1 * DAY }),
		];
		const result = by(UpcomingGrouping.Project, tasks);
		expect(result.sections.map((s) => s.key)).toEqual([
			"upcoming.project.p_a",
			"upcoming.project.p_b",
			"upcoming.project.none",
		]);
		expect(result.sections[0]?.title).toBe("Project P_A");
		expect(result.sections[2]?.titleKey).toBe("tasks.section.noProject");
	});

	it("groups by status, no-status bucket last", () => {
		const tasks: Task[] = [
			task({ id: "open", scheduledAt: NOW + 1 * DAY, statusKey: "todo" }),
			task({ id: "untracked", scheduledAt: NOW + 1 * DAY }),
		];
		const result = by(UpcomingGrouping.Status, tasks);
		expect(result.sections.map((s) => s.key)).toEqual([
			"upcoming.status.todo",
			"upcoming.status.none",
		]);
		expect(result.sections[1]?.titleKey).toBe("tasks.section.noStatus");
	});

	it("groups by tags — a multi-tagged task appears under each tag; untagged last", () => {
		const tasks: Task[] = [
			task({ id: "both", scheduledAt: NOW + 1 * DAY, tags: ["urgent", "home"] }),
			task({ id: "home", scheduledAt: NOW + 1 * DAY, tags: ["home"] }),
			task({ id: "bare", scheduledAt: NOW + 1 * DAY }),
		];
		const result = by(UpcomingGrouping.Tags, tasks);
		expect(result.sections.map((s) => s.key)).toEqual([
			"upcoming.tags.home",
			"upcoming.tags.urgent",
			"upcoming.tags.none",
		]);
		expect(result.sections[0]?.tasks.map((t) => t.id).sort()).toEqual(["both", "home"]);
		expect(result.sections[1]?.title).toBe("urgent");
		// `count` stays the distinct upcoming task count even though `both`
		// is sectioned twice.
		expect(result.count).toBe(3);
	});
});

describe("compileSurface — Project", () => {
	it("requires a projectId — throws otherwise", () => {
		expect(() => compileSurface([], TaskSurface.Project, { now: NOW })).toThrow(/projectId/);
	});

	it("scopes to the given project + sorts by due/scheduled asc with priority tie-break", () => {
		const tasks: Task[] = [
			task({ id: "p_far", projectId: "p", scheduledAt: NOW + 10 * DAY }),
			task({ id: "p_close", projectId: "p", scheduledAt: NOW + 2 * DAY }),
			task({ id: "p_unscheduled", projectId: "p" }),
			task({ id: "other", projectId: "q", scheduledAt: NOW + 2 * DAY }),
		];
		const result = compileSurface(tasks, TaskSurface.Project, {
			now: NOW,
			projectId: "p",
		});
		expect(result.projectId).toBe("p");
		expect(result.sections[0]?.tasks.map((t) => t.id)).toEqual(["p_close", "p_far", "p_unscheduled"]);
	});
});

describe("compileSurface — manual sortIndex in flat surfaces", () => {
	it("honours sortIndex first in the Inbox surface, then falls back to the auto sort for unindexed rows", () => {
		const tasks: Task[] = [
			task({ id: "crit_no_index", priority: Priority.Critical, createdAt: NOW - 9 * DAY }),
			task({ id: "low_two", priority: Priority.Low, createdAt: NOW - 8 * DAY, sortIndex: 1 }),
			task({ id: "none_one", priority: Priority.None, createdAt: NOW - 7 * DAY, sortIndex: 0 }),
		];
		const result = compileSurface(tasks, TaskSurface.Inbox, { now: NOW });
		expect(result.sections[0]?.tasks.map((t) => t.id)).toEqual([
			"none_one",
			"low_two",
			"crit_no_index",
		]);
	});

	it("honours sortIndex in a Project surface and keeps unindexed rows in due-order beneath the manual block", () => {
		const tasks: Task[] = [
			task({ id: "p_far", projectId: "p", scheduledAt: NOW + 10 * DAY }),
			task({ id: "p_close", projectId: "p", scheduledAt: NOW + 2 * DAY }),
			task({ id: "p_manual_top", projectId: "p", sortIndex: 0 }),
		];
		const result = compileSurface(tasks, TaskSurface.Project, { now: NOW, projectId: "p" });
		expect(result.sections[0]?.tasks.map((t) => t.id)).toEqual(["p_manual_top", "p_close", "p_far"]);
	});

	it("sinks done tasks to the bottom even when they carry a stale sortIndex from when they were open", () => {
		const tasks: Task[] = [
			task({ id: "stale_done", sortIndex: 0, completedAt: NOW - DAY }),
			task({ id: "fresh_open", sortIndex: 1 }),
		];
		const result = compileSurface(tasks, TaskSurface.Inbox, { now: NOW, showCompleted: true });
		expect(result.sections[0]?.tasks.map((t) => t.id)).toEqual(["fresh_open", "stale_done"]);
	});

	it("falls back to the auto sort untouched when no row in the list carries a sortIndex", () => {
		const tasks: Task[] = [
			task({ id: "low_old", priority: Priority.Low, createdAt: NOW - 10 * DAY }),
			task({ id: "crit_new", priority: Priority.Critical, createdAt: NOW - 1 * DAY }),
		];
		const result = compileSurface(tasks, TaskSurface.Inbox, { now: NOW });
		expect(result.sections[0]?.tasks.map((t) => t.id)).toEqual(["crit_new", "low_old"]);
	});
});

describe("compileSurface — explicit sort override", () => {
	it("Default sort keeps the surface's native order, including manual sortIndex", () => {
		const tasks: Task[] = [
			task({ id: "crit_no_index", priority: Priority.Critical, createdAt: NOW - 9 * DAY }),
			task({ id: "manual_top", priority: Priority.None, sortIndex: 0 }),
		];
		const result = compileSurface(tasks, TaskSurface.Inbox, { now: NOW, sort: TaskSort.Default });
		expect(result.sections[0]?.tasks.map((t) => t.id)).toEqual(["manual_top", "crit_no_index"]);
	});

	it("an explicit Name sort re-orders the flat list, ignoring sortIndex", () => {
		const tasks: Task[] = [
			task({ id: "z", name: "Zebra", sortIndex: 0 }),
			task({ id: "a", name: "Apple", sortIndex: 1 }),
			task({ id: "m", name: "Mango", sortIndex: 2 }),
		];
		const result = compileSurface(tasks, TaskSurface.Inbox, { now: NOW, sort: TaskSort.Name });
		expect(result.sections[0]?.tasks.map((t) => t.id)).toEqual(["a", "m", "z"]);
	});

	it("re-orders within each Upcoming date section without changing the sections", () => {
		const tasks: Task[] = [
			task({ id: "d1_b", name: "Beta", scheduledAt: NOW + DAY }),
			task({ id: "d1_a", name: "Alpha", scheduledAt: NOW + DAY }),
			task({ id: "d2", name: "Gamma", scheduledAt: NOW + 3 * DAY }),
		];
		const result = compileSurface(tasks, TaskSurface.Upcoming, { now: NOW, sort: TaskSort.Name });
		expect(result.sections.length).toBe(2);
		expect(result.sections[0]?.tasks.map((t) => t.id)).toEqual(["d1_a", "d1_b"]);
		expect(result.sections[1]?.tasks.map((t) => t.id)).toEqual(["d2"]);
	});
});

describe("compileSurface — subtask exclusion (9.14.7)", () => {
	it("excludes child tasks from a flat surface but keeps the parent", () => {
		const tasks: Task[] = [
			task({ id: "parent" }),
			task({ id: "child", parentId: "parent" }),
			task({ id: "solo" }),
		];
		const result = compileSurface(tasks, TaskSurface.Inbox, { now: NOW });
		const ids = result.sections.flatMap((s) => s.tasks.map((t) => t.id));
		expect(ids).toContain("parent");
		expect(ids).toContain("solo");
		expect(ids).not.toContain("child");
	});

	it("surfaces an orphan subtask whose parent no longer exists", () => {
		const tasks: Task[] = [task({ id: "orphan", parentId: "ghost" })];
		const result = compileSurface(tasks, TaskSurface.Inbox, { now: NOW });
		const ids = result.sections.flatMap((s) => s.tasks.map((t) => t.id));
		expect(ids).toContain("orphan");
	});
});
