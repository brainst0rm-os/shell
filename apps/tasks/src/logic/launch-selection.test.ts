/**
 * Tests for `pickInitialSelectionForLaunch`. Covers every reason the
 * cross-app `intent.open` dispatcher might hand to Tasks at boot.
 */
import { describe, expect, it } from "vitest";
import type { Project } from "../types/project";
import { TaskSurface } from "../types/surface";
import { Priority, type Task } from "../types/task";
import { pickInitialSelectionForLaunch } from "./launch-selection";

const NOW = Date.UTC(2026, 4, 14, 12, 0, 0); // 2026-05-14 noon UTC

function task(over: Partial<Task>): Task {
	return {
		id: "task_x",
		name: "x",
		notes: "",
		icon: null,
		completedAt: null,
		priority: Priority.None,
		scheduledAt: null,
		dueAt: null,
		projectId: null,
		assigneeId: null,
		parentId: null,
		recurrence: null,
		statusKey: null,
		createdAt: NOW - 100,
		updatedAt: NOW - 100,
		...over,
	};
}

function project(id: string): Project {
	return {
		id,
		name: id,
		description: "",
		icon: null,
		statusKey: null,
		milestoneAt: null,
		colorHint: null,
		createdAt: NOW - 1000,
		updatedAt: NOW - 1000,
	};
}

describe("pickInitialSelectionForLaunch", () => {
	it("returns null for a fresh launch", () => {
		const result = pickInitialSelectionForLaunch(
			{ reason: "fresh" },
			[task({})],
			[project("proj_a")],
			NOW,
		);
		expect(result).toBeNull();
	});

	it("returns null for session-restore", () => {
		const result = pickInitialSelectionForLaunch(
			{ reason: "session-restore" },
			[task({})],
			[project("proj_a")],
			NOW,
		);
		expect(result).toBeNull();
	});

	it("returns null for open-entity when the id matches nothing", () => {
		const result = pickInitialSelectionForLaunch(
			{ reason: "open-entity", entityId: "ent_unknown" },
			[task({ id: "task_a" })],
			[project("proj_a")],
			NOW,
		);
		expect(result).toBeNull();
	});

	it("jumps to a Project surface when the id matches a project", () => {
		const result = pickInitialSelectionForLaunch(
			{ reason: "open-entity", entityId: "proj_a" },
			[task({})],
			[project("proj_a")],
			NOW,
		);
		expect(result).toEqual({
			selection: { kind: TaskSurface.Project, projectId: "proj_a" },
			highlightTaskId: null,
		});
	});

	it("jumps to a task's containing Project and highlights the row", () => {
		const t = task({ id: "task_a", projectId: "proj_a" });
		const result = pickInitialSelectionForLaunch(
			{ reason: "open-entity", entityId: "task_a" },
			[t],
			[project("proj_a")],
			NOW,
		);
		expect(result).toEqual({
			selection: { kind: TaskSurface.Project, projectId: "proj_a" },
			highlightTaskId: "task_a",
		});
	});

	it("falls back to Inbox when the task has no project and no schedule", () => {
		const t = task({ id: "task_loose", projectId: null, scheduledAt: null });
		const result = pickInitialSelectionForLaunch(
			{ reason: "open-entity", entityId: "task_loose" },
			[t],
			[],
			NOW,
		);
		expect(result?.selection.kind).toBe(TaskSurface.Inbox);
		expect(result?.highlightTaskId).toBe("task_loose");
	});

	it("falls back to Today when the task is scheduled today", () => {
		const t = task({ id: "task_today", scheduledAt: NOW });
		const result = pickInitialSelectionForLaunch(
			{ reason: "open-entity", entityId: "task_today" },
			[t],
			[],
			NOW,
		);
		expect(result?.selection.kind).toBe(TaskSurface.Today);
	});

	it("falls back to Upcoming when the task is scheduled in the future", () => {
		const t = task({ id: "task_future", scheduledAt: NOW + 7 * 86_400_000 });
		const result = pickInitialSelectionForLaunch(
			{ reason: "open-entity", entityId: "task_future" },
			[t],
			[],
			NOW,
		);
		expect(result?.selection.kind).toBe(TaskSurface.Upcoming);
	});

	it("orphans a task whose project is missing from the project list — falls back to a built-in surface", () => {
		// Task has projectId but no matching Project record (legitimate
		// when the project entity was deleted out-of-band). We should not
		// dispatch to Project with a non-existent id; fall back.
		const t = task({ id: "task_orphan", projectId: "proj_deleted", scheduledAt: null });
		const result = pickInitialSelectionForLaunch(
			{ reason: "open-entity", entityId: "task_orphan" },
			[t],
			[],
			NOW,
		);
		expect(result?.selection.kind).toBe(TaskSurface.Inbox);
		expect(result?.highlightTaskId).toBe("task_orphan");
	});
});
