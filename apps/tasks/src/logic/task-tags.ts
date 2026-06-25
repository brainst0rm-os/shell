/**
 * Task tags (9.14.10) — pure normalise / add / remove / query helpers.
 *
 * Tags are free-form labels, normalised to trimmed lower-case so `Urgent` and
 * `urgent` are the same tag. All functions are pure over a flat task list so
 * the inspector tag editor, the row chips, and the tag filter share one model.
 */

import type { Task } from "../types/task";

/** Normalise a raw tag entry: trimmed, lower-cased, internal whitespace
 *  collapsed. Returns "" for a blank entry (the caller drops it). */
export function normalizeTag(raw: string): string {
	return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/** A task's tags (absent → []). */
export function tagsOf(task: Task): readonly string[] {
	return task.tags ?? [];
}

/** Add a normalised tag to a list, de-duplicated; a blank entry is a no-op
 *  (returns the original list reference unchanged in that case). */
export function addTag(tags: readonly string[], raw: string): string[] {
	const tag = normalizeTag(raw);
	if (tag.length === 0 || tags.includes(tag)) return [...tags];
	return [...tags, tag];
}

/** Remove a tag (matched after normalisation) from a list. */
export function removeTag(tags: readonly string[], raw: string): string[] {
	const tag = normalizeTag(raw);
	return tags.filter((t) => t !== tag);
}

/** Every distinct tag across the tasks, in first-seen order. */
export function allTags(tasks: readonly Task[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const task of tasks) {
		for (const tag of tagsOf(task)) {
			if (!seen.has(tag)) {
				seen.add(tag);
				out.push(tag);
			}
		}
	}
	return out;
}

/** Tasks carrying `tag` (normalised match). */
export function tasksWithTag(tasks: readonly Task[], tag: string): Task[] {
	const want = normalizeTag(tag);
	return tasks.filter((task) => tagsOf(task).includes(want));
}
