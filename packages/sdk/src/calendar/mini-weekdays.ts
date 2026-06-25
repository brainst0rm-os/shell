/**
 * Shared pure helper: the default narrow weekday labels for a mini-calendar
 * density (first letter of each locale weekday). Extracted so the imperative
 * `createMiniCalendar` and the React `MiniCalendar` twin can't drift.
 */

import { WeekStartsOn } from "../date-grid/date-grid";

export function defaultMiniWeekdays(weekStartsOn: WeekStartsOn | undefined): ReadonlyArray<string> {
	const wk = weekStartsOn ?? WeekStartsOn.Sunday;
	// 2026-01-04 is a Sunday — same anchor as date-grid.weekdayLabels.
	const anchor = new Date(2026, 0, 4);
	const out: string[] = new Array(7);
	for (let i = 0; i < 7; i += 1) {
		const d = new Date(
			anchor.getFullYear(),
			anchor.getMonth(),
			anchor.getDate() + ((wk as number) % 7) + i,
		);
		const short = d.toLocaleDateString(undefined, { weekday: "narrow" });
		out[i] =
			short.length > 0 ? short : d.toLocaleDateString(undefined, { weekday: "short" }).charAt(0);
	}
	return out;
}
