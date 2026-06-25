/**
 * Serialize a set of tasks for the clipboard. Markdown checkbox lines
 * (`- [ ] name` / `- [x] name`) — the most portable format: pastes as a live
 * checklist into the Notes/Journal editors, stays readable as plain text, and
 * round-trips through any markdown surface. Used by the list's multi-select
 * copy (Mod+C). Order follows what the caller passes (the visible row order).
 */

import type { Task } from "../types/task";

export function serializeTasksForClipboard(tasks: ReadonlyArray<Task>): string {
	return tasks.map((task) => `- [${task.completedAt !== null ? "x" : " "}] ${task.name}`).join("\n");
}
