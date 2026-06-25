/**
 * The four canonical surfaces the Tasks app renders. Each surface is a
 * curated query over the Task entity space; the user-visible navigation
 * sidebar exposes them in this order.
 *
 * Resolves the surface enumeration call-out in Stage 9.14 / the
 * first-party apps roadmap memory.
 */

export enum TaskSurface {
	/** Tasks with no project AND no scheduled date — the catch-bucket. */
	Inbox = "inbox",
	/** Tasks with `scheduledAt` <= end-of-today, still open. */
	Today = "today",
	/** Tasks with `scheduledAt` > end-of-today, grouped by date. */
	Upcoming = "upcoming",
	/** One specific project's tasks. The render side carries the
	 *  project id alongside the enum; this kind on its own is incomplete. */
	Project = "project",
	/** Kanban-by-status board across all top-level tasks (9.14.10). */
	Board = "board",
	/** Gantt timeline of dated top-level tasks (9.14.11). */
	Timeline = "timeline",
}

/** How the Upcoming surface sections its tasks (F-164). Date is the
 *  default chronology; the rest re-section the SAME date-scoped task set
 *  along a different task axis — "what's on this person's plate this
 *  week" (Assignee), "what's urgent" (Priority), etc. The header exposes
 *  this as a "Group by ▾" picker, not a hardcoded toggle — any axis here
 *  is a one-click choice. */
export enum UpcomingGrouping {
	Date = "date",
	Assignee = "assignee",
	Priority = "priority",
	Project = "project",
	Status = "status",
	Tags = "tags",
}

/** All grouping axes in the order the "Group by" picker lists them —
 *  frozen, safe to iterate. */
export const UPCOMING_GROUPINGS: readonly UpcomingGrouping[] = Object.freeze([
	UpcomingGrouping.Date,
	UpcomingGrouping.Assignee,
	UpcomingGrouping.Priority,
	UpcomingGrouping.Project,
	UpcomingGrouping.Status,
	UpcomingGrouping.Tags,
]);

/** All surfaces in display order — frozen, safe to iterate. */
export const TASK_SURFACES: readonly TaskSurface[] = Object.freeze([
	TaskSurface.Inbox,
	TaskSurface.Today,
	TaskSurface.Upcoming,
	TaskSurface.Board,
	TaskSurface.Timeline,
	TaskSurface.Project,
]);
