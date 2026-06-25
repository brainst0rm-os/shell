/**
 * Tests for the `intent.compose` payload → `Task` projection — the pure
 * core of the Notes `/task` slash path.
 */
import { describe, expect, it } from "vitest";
import { Priority, TaskStatus } from "../types/task";
import { composeTask, parseComposePayload } from "./compose-task";

const NOW = Date.UTC(2026, 4, 18, 9, 0, 0);

describe("parseComposePayload", () => {
	it("reads `name`", () => {
		expect(parseComposePayload({ name: "Buy milk" })).toEqual({ name: "Buy milk" });
	});

	it("falls back to `title` when `name` is absent", () => {
		expect(parseComposePayload({ title: "From Notes" })).toEqual({ name: "From Notes" });
	});

	it("trims whitespace", () => {
		expect(parseComposePayload({ name: "  spaced  " })).toEqual({ name: "spaced" });
	});

	it("returns null when there is no usable name", () => {
		expect(parseComposePayload({})).toBeNull();
		expect(parseComposePayload({ name: "   " })).toBeNull();
		expect(parseComposePayload({ name: 42 })).toBeNull();
	});

	it("carries optional project / dates / notes when well-typed", () => {
		expect(
			parseComposePayload({
				name: "x",
				projectId: "proj-a",
				scheduledAt: NOW,
				dueAt: NOW + 1000,
				notes: "context",
			}),
		).toEqual({
			name: "x",
			projectId: "proj-a",
			scheduledAt: NOW,
			dueAt: NOW + 1000,
			notes: "context",
		});
	});

	it("ignores mistyped optional fields", () => {
		expect(
			parseComposePayload({ name: "x", projectId: 7, scheduledAt: "soon", notes: false }),
		).toEqual({ name: "x" });
	});
});

describe("composeTask", () => {
	it("builds a fresh open task with defaults", () => {
		const task = composeTask({ name: "Write report" }, { id: "task-1", now: NOW });
		expect(task).toMatchObject({
			id: "task-1",
			name: "Write report",
			completedAt: null,
			priority: Priority.None,
			scheduledAt: null,
			dueAt: null,
			projectId: null,
			recurrence: null,
			statusKey: null,
			createdAt: NOW,
			updatedAt: NOW,
		});
	});

	it("threads project + schedule + notes through", () => {
		const task = composeTask(
			{ name: "Ship", projectId: "proj-x", scheduledAt: NOW, dueAt: NOW + 5, notes: "ASAP" },
			{ id: "task-2", now: NOW },
		);
		expect(task.projectId).toBe("proj-x");
		expect(task.scheduledAt).toBe(NOW);
		expect(task.dueAt).toBe(NOW + 5);
		expect(task.notes).toBe("ASAP");
	});

	it("omits notes when absent (exactOptionalPropertyTypes-safe)", () => {
		const task = composeTask({ name: "x" }, { id: "task-3", now: NOW });
		expect("notes" in task).toBe(false);
	});

	it("respects an explicit priority on the input", () => {
		const task = composeTask(
			{ name: "Urgent", priority: Priority.Critical },
			{ id: "task-4", now: NOW },
		);
		expect(task.priority).toBe(Priority.Critical);
	});

	it("materialises an explicit statusKey (board column add, F-207)", () => {
		const task = composeTask(
			{ name: "From the board", statusKey: TaskStatus.InProgress },
			{ id: "task-5", now: NOW },
		);
		expect(task.statusKey).toBe(TaskStatus.InProgress);
	});
});
