/**
 * Default start instant for a newly composed event (F-218): the view's
 * explicitly selected day when it has one (Day view anchor), else the day
 * containing `now`, at the next full hour. Pure — the clock is injected.
 */

import { startOfDay } from "./date-range";

const HOUR_MS = 3_600_000;

export type DefaultEventStartInput = {
	/**
	 * Day-start epoch ms of the view's selected/focused day, or `null` when
	 * the view has no single-day selection (month / week / year / agenda).
	 */
	selectedDayStart: number | null;
	now: number;
};

export function nextFullHour(now: number): number {
	const d = new Date(now);
	d.setMinutes(0, 0, 0);
	const floored = d.getTime();
	return floored === now ? now : floored + HOUR_MS;
}

export function defaultEventStart({ selectedDayStart, now }: DefaultEventStartInput): number {
	const next = nextFullHour(now);
	if (selectedDayStart === null) return next;
	if (startOfDay(next) === startOfDay(selectedDayStart)) return next;
	const onDay = new Date(selectedDayStart);
	onDay.setHours(new Date(next).getHours(), 0, 0, 0);
	return onDay.getTime();
}
