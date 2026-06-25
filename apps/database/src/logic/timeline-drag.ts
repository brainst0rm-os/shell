/**
 * 9.12.10 — pure math for the Timeline's drag interactions: drag a bar to
 * move it along the date axis, drag its right edge to resize the span.
 * The renderer feeds pixel deltas; this converts them to whole-day date
 * mutations the host persists through the entities service. Whole days
 * because the timeline's storage grain is the day (the calendar's
 * day-drop precedent) — sub-day precision at low zoom would write noisy
 * fractional timestamps the grid then renders as odd times.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Horizontal pixel delta → whole-day delta at the current zoom. */
export function dragDeltaDays(dxPx: number, pxPerDay: number): number {
	if (!Number.isFinite(dxPx) || !Number.isFinite(pxPerDay) || pxPerDay <= 0) return 0;
	return Math.round(dxPx / pxPerDay);
}

/** Shift a span (or a point event, `end === null`) by `deltaDays`. */
export function movedDates(
	item: { start: number; end: number | null },
	deltaDays: number,
): { start: number; end: number | null } {
	const offset = deltaDays * DAY_MS;
	return { start: item.start + offset, end: item.end === null ? null : item.end + offset };
}

/** Resize a span's end by `deltaDays`, clamped so the span never inverts
 *  (end < start). A clamp to exactly `start` is a zero-length span — the
 *  renderer paints it at its minimum visual width. */
export function resizedEnd(start: number, end: number, deltaDays: number): number {
	return Math.max(start, end + deltaDays * DAY_MS);
}

/** A press is a drag (not a click) once it travels this many px. */
export const DRAG_THRESHOLD_PX = 4;

export function isDragMovement(dxPx: number): boolean {
	return Math.abs(dxPx) >= DRAG_THRESHOLD_PX;
}
