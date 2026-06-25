/**
 * Pure helpers over `Task` state — done-ness, overdue-ness, and which
 * surface a task currently belongs to.
 *
 * Long-term keystones: these survive the Stage 9.14.2 entities-service
 * swap unchanged (Task shape is part of the contract; the storage
 * substrate is not).
 */

import { TaskSurface } from "../types/surface";
import type { Task } from "../types/task";
import { startOfToday } from "./date-buckets";

export function isDone(task: Task): boolean {
	return task.completedAt !== null;
}

export function isOverdue(task: Task, now: number): boolean {
	if (isDone(task)) return false;
	if (task.dueAt === null) return false;
	return task.dueAt < now;
}

/** The user-facing "you've fallen behind" predicate: a passed deadline
 *  (`isOverdue` → dueAt < now) OR an OPEN task whose scheduled day is already
 *  in the past (scheduledAt < start-of-today). A scheduled date that has
 *  slipped is just as overdue to the user as a missed deadline — without this,
 *  a task scheduled days ago silently sat under the literal "Today" heading
 *  with a dim date chip. The single source of truth shared by the Today-
 *  surface Overdue partition and the row / inspector overdue styling, so a row
 *  shown under "Overdue" always reads as overdue. The `< startOfToday`
 *  boundary keeps tasks scheduled earlier *today* out of overdue. */
export function isPastDue(task: Task, now: number): boolean {
	if (isDone(task)) return false;
	if (isOverdue(task, now)) return true;
	return task.scheduledAt !== null && task.scheduledAt < startOfToday(now);
}

/** Returns the surface a task currently belongs to.
 *
 *  Project tasks always render under their project (even if scheduled
 *  today), so Project takes precedence. Then a scheduled date picks
 *  Today / Upcoming. The leftover is Inbox.
 *
 *  `endOfToday` is the epoch-ms boundary at 23:59:59.999 of today in
 *  the user's local timezone — passed in by the renderer so this
 *  helper stays pure (no Date.now / no implicit TZ). */
export function surfaceFor(task: Task, endOfToday: number): TaskSurface {
	if (task.projectId !== null) return TaskSurface.Project;
	if (task.scheduledAt !== null) {
		return task.scheduledAt <= endOfToday ? TaskSurface.Today : TaskSurface.Upcoming;
	}
	return TaskSurface.Inbox;
}
