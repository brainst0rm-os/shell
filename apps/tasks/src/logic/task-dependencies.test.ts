import { describe, expect, it } from "vitest";
import { Priority, type Task } from "../types/task";
import {
	blockingTasks,
	dependenciesOf,
	dependencyCandidates,
	indexById,
	isBlocked,
	wouldCreateDependencyCycle,
} from "./task-dependencies";

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
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	};
}

describe("task-dependencies", () => {
	it("dependenciesOf normalises absent to []", () => {
		expect(dependenciesOf(task("a"))).toEqual([]);
		expect(dependenciesOf(task("a", { dependsOn: ["b"] }))).toEqual(["b"]);
	});

	it("isBlocked is true only while a dependency is open", () => {
		const dep = task("dep");
		const blocked = task("t", { dependsOn: ["dep"] });
		const byOpen = indexById([dep, blocked]);
		expect(isBlocked(blocked, byOpen)).toBe(true);
		expect(blockingTasks(blocked, byOpen).map((t) => t.id)).toEqual(["dep"]);

		const doneDep = task("dep", { completedAt: 100 });
		const byDone = indexById([doneDep, blocked]);
		expect(isBlocked(blocked, byDone)).toBe(false);
	});

	it("a missing dependency does not block", () => {
		const blocked = task("t", { dependsOn: ["ghost"] });
		expect(isBlocked(blocked, indexById([blocked]))).toBe(false);
	});

	it("wouldCreateDependencyCycle catches self, direct, and transitive loops", () => {
		// a depends on b, b depends on c.
		const tasks = [task("a", { dependsOn: ["b"] }), task("b", { dependsOn: ["c"] }), task("c")];
		expect(wouldCreateDependencyCycle(tasks, "a", "a")).toBe(true); // self
		// Adding c→a would loop (a→b→c→a).
		expect(wouldCreateDependencyCycle(tasks, "c", "a")).toBe(true);
		// Adding c→b would loop (b→c→b).
		expect(wouldCreateDependencyCycle(tasks, "c", "b")).toBe(true);
		// Adding a→c is fine (a already reaches c, no loop back to a).
		expect(wouldCreateDependencyCycle(tasks, "a", "c")).toBe(false);
	});

	it("wouldCreateDependencyCycle terminates on a pre-existing loop", () => {
		const tasks = [task("x", { dependsOn: ["y"] }), task("y", { dependsOn: ["x"] })];
		expect(wouldCreateDependencyCycle(tasks, "z", "x")).toBe(false);
	});

	it("dependencyCandidates excludes self, existing deps, and cycle-creators", () => {
		const tasks = [task("a", { dependsOn: ["b"] }), task("b"), task("c")];
		// For task a: self (a) out, existing dep (b) out, c allowed.
		expect(dependencyCandidates(tasks, tasks[0] as Task).map((t) => t.id)).toEqual(["c"]);
		// For task b: adding a would loop (a→b→a), so a is excluded; c allowed.
		expect(dependencyCandidates(tasks, tasks[1] as Task).map((t) => t.id)).toEqual(["c"]);
	});
});
