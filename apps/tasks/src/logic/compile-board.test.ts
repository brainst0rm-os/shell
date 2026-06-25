import { describe, expect, it } from "vitest";
import { Priority, type Task, TaskStatus } from "../types/task";
import { type BoardColumn, compileBoard, effectiveStatusKey } from "./compile-board";

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

const ORDER = [TaskStatus.Todo, TaskStatus.InProgress, TaskStatus.Done, TaskStatus.Cancelled];
const keys = (cols: BoardColumn[]) => cols.map((c) => c.key);
const idsIn = (cols: BoardColumn[], key: string) =>
	cols.find((c) => c.key === key)?.tasks.map((t) => t.id) ?? [];

describe("effectiveStatusKey", () => {
	it("keeps an explicit statusKey verbatim", () => {
		expect(effectiveStatusKey(task("a", { statusKey: TaskStatus.InProgress }))).toBe(
			TaskStatus.InProgress,
		);
		expect(effectiveStatusKey(task("b", { statusKey: "needs-review" }))).toBe("needs-review");
	});

	it("defaults an open statusless task to To-do (F-207)", () => {
		expect(effectiveStatusKey(task("a"))).toBe(TaskStatus.Todo);
	});

	it("defaults a completed statusless task to Done", () => {
		expect(effectiveStatusKey(task("a", { completedAt: 123 }))).toBe(TaskStatus.Done);
	});
});

describe("compileBoard", () => {
	it("always presents the canonical columns in order — no No-status column", () => {
		expect(keys(compileBoard([], ORDER))).toEqual([
			TaskStatus.Todo,
			TaskStatus.InProgress,
			TaskStatus.Done,
			TaskStatus.Cancelled,
		]);
	});

	it("buckets tasks by statusKey", () => {
		const cols = compileBoard(
			[
				task("a", { statusKey: TaskStatus.Todo }),
				task("b", { statusKey: TaskStatus.Done }),
				task("d", { statusKey: TaskStatus.Todo }),
			],
			ORDER,
		);
		expect(idsIn(cols, TaskStatus.Todo)).toEqual(["a", "d"]);
		expect(idsIn(cols, TaskStatus.Done)).toEqual(["b"]);
		expect(idsIn(cols, TaskStatus.InProgress)).toEqual([]);
	});

	it("buckets open statusless tasks into To-do (F-207 — capture flows never set a status)", () => {
		const cols = compileBoard([task("captured"), task("inbox")], ORDER);
		expect(idsIn(cols, TaskStatus.Todo)).toEqual(["captured", "inbox"]);
	});

	it("buckets completed statusless tasks into Done, not To-do", () => {
		const cols = compileBoard([task("shipped", { completedAt: 99 }), task("open")], ORDER);
		expect(idsIn(cols, TaskStatus.Done)).toEqual(["shipped"]);
		expect(idsIn(cols, TaskStatus.Todo)).toEqual(["open"]);
	});

	it("appends a column for a custom status not in the canonical order", () => {
		const cols = compileBoard([task("x", { statusKey: "needs-review" })], ORDER);
		expect(keys(cols)).toEqual([...ORDER, "needs-review"]);
		expect(idsIn(cols, "needs-review")).toEqual(["x"]);
	});

	it("excludes subtasks (they live under their parent)", () => {
		const cols = compileBoard(
			[
				task("p", { statusKey: TaskStatus.Todo }),
				task("c", { parentId: "p", statusKey: TaskStatus.Todo }),
			],
			ORDER,
		);
		expect(idsIn(cols, TaskStatus.Todo)).toEqual(["p"]);
	});

	it("surfaces an orphan subtask (missing parent)", () => {
		const cols = compileBoard([task("o", { parentId: "ghost", statusKey: TaskStatus.Todo })], ORDER);
		expect(idsIn(cols, TaskStatus.Todo)).toEqual(["o"]);
	});
});
