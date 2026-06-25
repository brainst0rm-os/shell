/**
 * Pure reducer behind the Tasks "Task Stats" widget (small). Kept apart from
 * `widget.tsx` so it unit-tests without dragging the component's CSS-subpath
 * imports into the test graph.
 */

/** Local calendar-day start (DST-safe — `setHours` lands on local midnight). */
export function startOfDay(ms: number): number {
	const d = new Date(ms);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

export function dueAtOf(properties: Record<string, unknown>): number | null {
	const dueAt = properties.dueAt;
	return typeof dueAt === "number" && Number.isFinite(dueAt) ? dueAt : null;
}

/** A representative task id for a stat bucket (the one its click opens), or null
 *  when the bucket is empty. */
export type StatBucket = { count: number; topId: string | null };

/** A single open task as the stat card sees it. */
export type StatTask = { id: string; updatedAt: number; dueAt: number | null };

export type TaskStatsData = { open: StatBucket; overdue: StatBucket; dueToday: StatBucket };

/** Reduce the open tasks to the three glance buckets. Pure (takes `now`) so it
 *  unit-tests without a clock; each bucket carries the id its click opens — the
 *  most-recent open task, and the most-overdue / earliest-due-today task. */
export function computeTaskStats(open: readonly StatTask[], now: number): TaskStatsData {
	const dayStart = startOfDay(now);
	const dayEnd = startOfDay(now + 24 * 60 * 60 * 1000);

	let recent: StatTask | null = null;
	let mostOverdue: StatTask | null = null;
	let earliestToday: StatTask | null = null;
	let overdueCount = 0;
	let todayCount = 0;

	for (const task of open) {
		if (recent === null || task.updatedAt > recent.updatedAt) recent = task;
		const due = task.dueAt;
		if (due === null) continue;
		if (due < dayStart) {
			overdueCount += 1;
			if (mostOverdue === null || due < (mostOverdue.dueAt ?? Number.POSITIVE_INFINITY)) {
				mostOverdue = task;
			}
		} else if (due < dayEnd) {
			todayCount += 1;
			if (earliestToday === null || due < (earliestToday.dueAt ?? Number.POSITIVE_INFINITY)) {
				earliestToday = task;
			}
		}
	}

	return {
		open: { count: open.length, topId: recent?.id ?? null },
		overdue: { count: overdueCount, topId: mostOverdue?.id ?? null },
		dueToday: { count: todayCount, topId: earliestToday?.id ?? null },
	};
}
