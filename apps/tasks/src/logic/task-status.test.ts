import { describe, expect, it } from "vitest";
import { TaskSurface } from "../types/surface";
import { Priority, type Task } from "../types/task";
import { isDone, isOverdue, surfaceFor } from "./task-status";

function baseTask(overrides: Partial<Task> = {}): Task {
	return {
		id: "task_1",
		name: "Test task",
		completedAt: null,
		priority: Priority.None,
		scheduledAt: null,
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

describe("isDone", () => {
	it("true when completedAt is set", () => {
		expect(isDone(baseTask({ completedAt: 1000 }))).toBe(true);
	});

	it("false when completedAt is null", () => {
		expect(isDone(baseTask())).toBe(false);
	});

	it("a 0 completedAt counts as done (epoch start = a write happened)", () => {
		expect(isDone(baseTask({ completedAt: 0 }))).toBe(true);
	});
});

describe("isOverdue", () => {
	const NOW = 1_000_000;

	it("false when dueAt is null", () => {
		expect(isOverdue(baseTask({ dueAt: null }), NOW)).toBe(false);
	});

	it("false when due in the future", () => {
		expect(isOverdue(baseTask({ dueAt: NOW + 1000 }), NOW)).toBe(false);
	});

	it("false when due == now (strictly less)", () => {
		expect(isOverdue(baseTask({ dueAt: NOW }), NOW)).toBe(false);
	});

	it("true when due is in the past and the task is open", () => {
		expect(isOverdue(baseTask({ dueAt: NOW - 1000 }), NOW)).toBe(true);
	});

	it("false when due is in the past but the task is done", () => {
		expect(isOverdue(baseTask({ dueAt: NOW - 1000, completedAt: NOW - 500 }), NOW)).toBe(false);
	});
});

describe("surfaceFor", () => {
	const END_OF_TODAY = 1_000_000;

	it("Project — when projectId is set, even if scheduled today", () => {
		expect(
			surfaceFor(baseTask({ projectId: "proj_1", scheduledAt: END_OF_TODAY }), END_OF_TODAY),
		).toBe(TaskSurface.Project);
	});

	it("Today — when scheduled <= end of today and no project", () => {
		expect(surfaceFor(baseTask({ scheduledAt: END_OF_TODAY - 1000 }), END_OF_TODAY)).toBe(
			TaskSurface.Today,
		);
		expect(surfaceFor(baseTask({ scheduledAt: END_OF_TODAY }), END_OF_TODAY)).toBe(TaskSurface.Today);
	});

	it("Upcoming — when scheduled > end of today and no project", () => {
		expect(surfaceFor(baseTask({ scheduledAt: END_OF_TODAY + 1 }), END_OF_TODAY)).toBe(
			TaskSurface.Upcoming,
		);
	});

	it("Inbox — when neither project nor scheduledAt is set", () => {
		expect(surfaceFor(baseTask(), END_OF_TODAY)).toBe(TaskSurface.Inbox);
	});

	it("done tasks still get a surface (caller decides whether to show)", () => {
		expect(surfaceFor(baseTask({ completedAt: 0 }), END_OF_TODAY)).toBe(TaskSurface.Inbox);
	});
});
