import { describe, expect, it } from "vitest";
import { Priority, type Task } from "../types/task";
import { localTaskMatch, taskSearchFromHits } from "./search-results";

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
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

describe("taskSearchFromHits", () => {
	it("projects tasks to the hit id set in the index's rank order", () => {
		const tasks = [task({ id: "a" }), task({ id: "b" }), task({ id: "c" })];
		const hits = [{ entityId: "c" }, { entityId: "a" }];
		expect(taskSearchFromHits(tasks, hits).map((t) => t.id)).toEqual(["c", "a"]);
	});

	it("drops hits with no matching in-memory task (sibling/stale ids)", () => {
		const tasks = [task({ id: "a" })];
		const hits = [{ entityId: "ghost" }, { entityId: "a" }];
		expect(taskSearchFromHits(tasks, hits).map((t) => t.id)).toEqual(["a"]);
	});

	it("returns [] for no hits", () => {
		expect(taskSearchFromHits([task({ id: "a" })], [])).toEqual([]);
	});
});

describe("localTaskMatch", () => {
	it("matches name or notes, case-insensitively, preserving input order", () => {
		const tasks = [
			task({ id: "1", name: "Buy MILK" }),
			task({ id: "2", name: "Walk dog", notes: "near the milk bar" }),
			task({ id: "3", name: "Unrelated" }),
		];
		expect(localTaskMatch(tasks, "milk").map((t) => t.id)).toEqual(["1", "2"]);
	});

	it("returns [] for empty / whitespace text", () => {
		const tasks = [task({ id: "1", name: "anything" })];
		expect(localTaskMatch(tasks, "")).toEqual([]);
		expect(localTaskMatch(tasks, "   ")).toEqual([]);
	});

	it("no match → []", () => {
		expect(localTaskMatch([task({ id: "1", name: "abc" })], "xyz")).toEqual([]);
	});
});
