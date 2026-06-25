/**
 * Task comments / activity thread (9.14.14) — pure list helpers.
 *
 * Comments are an embedded oldest-first array on the task (single-vault v1; a
 * collaborative comment model would promote these to entities later). The
 * helpers are pure so the inspector thread + tests share the add/remove logic.
 */

import type { TaskComment } from "../types/task";

/** A task's comments (absent → []). */
export function commentsOf(comments: readonly TaskComment[] | undefined): readonly TaskComment[] {
	return comments ?? [];
}

/** Append a comment (trimmed body) to the thread. A blank body is a no-op —
 *  returns a copy of the original list unchanged. */
export function addComment(
	comments: readonly TaskComment[],
	body: string,
	id: string,
	at: number,
): TaskComment[] {
	const trimmed = body.trim();
	if (trimmed.length === 0) return [...comments];
	return [...comments, { id, body: trimmed, at }];
}

/** Remove a comment by id. */
export function removeComment(comments: readonly TaskComment[], id: string): TaskComment[] {
	return comments.filter((c) => c.id !== id);
}

/** Coerce a stored value into a clean `TaskComment[]` (codec boundary) —
 *  drops entries missing a string id / body or a finite `at`. */
export function parseComments(raw: unknown): TaskComment[] {
	if (!Array.isArray(raw)) return [];
	const out: TaskComment[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") continue;
		const c = entry as Record<string, unknown>;
		if (typeof c.id !== "string" || c.id.length === 0) continue;
		if (typeof c.body !== "string") continue;
		if (typeof c.at !== "number" || !Number.isFinite(c.at)) continue;
		out.push({ id: c.id, body: c.body, at: c.at });
	}
	return out;
}
