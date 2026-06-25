import { describe, expect, it } from "vitest";
import { Priority, type Task } from "../types/task";
import { TaskSort, sortTasks } from "./task-sort";

const DAY = 86_400_000;
const NOW = new Date(2026, 4, 14, 10, 0, 0, 0).getTime();

function task(overrides: Partial<Task> & { id: string }): Task {
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

const ids = (tasks: readonly Task[]) => tasks.map((t) => t.id);

describe("sortTasks", () => {
	it("Default leaves order untouched (no-op copy)", () => {
		const input = [task({ id: "b" }), task({ id: "a" }), task({ id: "c" })];
		const out = sortTasks(input, TaskSort.Default);
		expect(ids(out)).toEqual(["b", "a", "c"]);
		expect(out).not.toBe(input);
	});

	it("Priority orders Critical → None, createdAt asc as the tie-break", () => {
		const tasks = [
			task({ id: "none", priority: Priority.None }),
			task({ id: "crit", priority: Priority.Critical }),
			task({ id: "high_new", priority: Priority.High, createdAt: NOW - DAY }),
			task({ id: "high_old", priority: Priority.High, createdAt: NOW - 5 * DAY }),
		];
		expect(ids(sortTasks(tasks, TaskSort.Priority))).toEqual([
			"crit",
			"high_old",
			"high_new",
			"none",
		]);
	});

	it("DueDate orders by dueAt ?? scheduledAt ascending, nulls last", () => {
		const tasks = [
			task({ id: "no_date" }),
			task({ id: "due_late", dueAt: NOW + 5 * DAY }),
			task({ id: "due_soon", dueAt: NOW + DAY }),
			task({ id: "scheduled_only", scheduledAt: NOW + 2 * DAY }),
		];
		expect(ids(sortTasks(tasks, TaskSort.DueDate))).toEqual([
			"due_soon",
			"scheduled_only",
			"due_late",
			"no_date",
		]);
	});

	it("Name orders case-insensitively A→Z", () => {
		const tasks = [
			task({ id: "1", name: "banana" }),
			task({ id: "2", name: "Apple" }),
			task({ id: "3", name: "cherry" }),
		];
		expect(ids(sortTasks(tasks, TaskSort.Name))).toEqual(["2", "1", "3"]);
	});

	it("Created orders most-recently-created first", () => {
		const tasks = [
			task({ id: "old", createdAt: NOW - 10 * DAY }),
			task({ id: "new", createdAt: NOW - DAY }),
			task({ id: "mid", createdAt: NOW - 5 * DAY }),
		];
		expect(ids(sortTasks(tasks, TaskSort.Created))).toEqual(["new", "mid", "old"]);
	});

	it("sinks completed tasks below every open task regardless of sort key", () => {
		const tasks = [
			task({ id: "done_recent", completedAt: NOW - DAY, priority: Priority.Critical }),
			task({ id: "open_low", priority: Priority.Low }),
			task({ id: "done_old", completedAt: NOW - 5 * DAY, priority: Priority.Critical }),
		];
		// Open task first even though it's lowest priority; done block ordered
		// most-recently-completed first.
		expect(ids(sortTasks(tasks, TaskSort.Priority))).toEqual(["open_low", "done_recent", "done_old"]);
	});
});
