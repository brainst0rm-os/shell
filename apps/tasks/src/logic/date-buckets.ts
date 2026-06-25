/**
 * Date-bucketing helpers for the Today / Upcoming / Project surfaces.
 *
 * Long-term keystones: these survive the Stage 9.14.2 entities-service
 * swap unchanged. They operate on epoch ms + a host-supplied "now"
 * anchor (no Date.now / no implicit TZ), so the demo's `DEMO_NOW` and
 * production's `Date.now()` both flow through the same paths.
 */

import type { Task } from "../types/task";

/** Epoch ms at the LOCAL boundary 23:59:59.999 on the day containing `now`. */
export function endOfToday(now: number): number {
	const d = new Date(now);
	d.setHours(23, 59, 59, 999);
	return d.getTime();
}

/** Epoch ms at the LOCAL boundary 00:00:00.000 on the day containing `now`. */
export function startOfToday(now: number): number {
	const d = new Date(now);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

/** Stable date key (`YYYY-MM-DD` in local tz) for grouping rows by day. */
export function dateKey(epochMs: number): string {
	const d = new Date(epochMs);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

export type DateGroup = {
	/** `YYYY-MM-DD` key — stable across renders, useful for React keys. */
	key: string;
	/** Epoch ms at start-of-day for the group. */
	startOfDay: number;
	/** Tasks anchored at this date (sorted by caller). */
	tasks: Task[];
};

/** Group tasks by the local date their `scheduledAt` falls on. Tasks
 *  without a `scheduledAt` are dropped — callers that want unscheduled
 *  rows put them in a separate bucket. Groups are returned in ascending
 *  date order. */
export function groupByScheduledDate(tasks: readonly Task[]): DateGroup[] {
	const groups = new Map<string, DateGroup>();
	for (const task of tasks) {
		if (task.scheduledAt === null) continue;
		const key = dateKey(task.scheduledAt);
		let group = groups.get(key);
		if (!group) {
			const d = new Date(task.scheduledAt);
			d.setHours(0, 0, 0, 0);
			group = { key, startOfDay: d.getTime(), tasks: [] };
			groups.set(key, group);
		}
		group.tasks.push(task);
	}
	return [...groups.values()].sort((a, b) => a.startOfDay - b.startOfDay);
}
