/**
 * Status board compiler (9.14.10) — groups tasks into kanban columns by their
 * *effective* status. Pure over a flat task list so the board view + DnD
 * consume it without owning the bucketing.
 *
 * A task that carries no `statusKey` is bucketed presentationally (F-207 —
 * no capture flow materialises a status, so a literal `null` bucket put every
 * captured task in a useless "No status" column): a completed statusless task
 * reads as Done, an open one as To-do. The stored entity is NOT rewritten —
 * the status only materialises when the user drags the card or creates it
 * from a column.
 *
 * Columns are the canonical seeded statuses (passed in so labels stay
 * app-side), then any custom status present in the data that isn't canonical —
 * so a user's own state still gets a column. Canonical columns are always
 * present (even empty) as drop targets; custom columns only appear when
 * populated. Subtasks live under their parent (excluded via `topLevelTasks`),
 * matching the flat surfaces.
 */

import { TaskStatus } from "../types/task";
import type { Task } from "../types/task";
import { topLevelTasks } from "./subtask-tree";

export type BoardColumn = {
	/** The status key this column collects (canonical or custom). */
	key: string;
	tasks: Task[];
};

/** The column a task belongs to: its own `statusKey`, else a presentation
 *  default — Done when completed, To-do otherwise. */
export function effectiveStatusKey(task: Task): string {
	if (task.statusKey !== null) return task.statusKey;
	return task.completedAt !== null ? TaskStatus.Done : TaskStatus.Todo;
}

export function compileBoard(
	tasks: readonly Task[],
	statusOrder: readonly string[],
): BoardColumn[] {
	const top = topLevelTasks(tasks);

	const order: string[] = [...statusOrder];
	const seen = new Set<string>(order);
	for (const task of top) {
		const key = effectiveStatusKey(task);
		if (!seen.has(key)) {
			order.push(key);
			seen.add(key);
		}
	}

	const byKey = new Map<string, Task[]>();
	for (const key of order) byKey.set(key, []);
	for (const task of top) {
		byKey.get(effectiveStatusKey(task))?.push(task);
	}

	return order.map((key) => ({ key, tasks: byKey.get(key) ?? [] }));
}
