/**
 * Recurrence — vault-level discriminated union shared by Tasks (`Task.recurrence`)
 * and Calendar (`Event.recurrence`). Resolves OQ-TK-1 / OQ-CAL-1.
 *
 * Structured kinds cover ~95% of user-authored recurrences (RRULE BYDAY +
 * BYMONTHDAY + INTERVAL subset); the `Custom { rrule }` escape hatch holds
 * a raw RFC 5545 RRULE string for the rare cases the structured form
 * cannot express.
 */

export enum RecurrenceKind {
	Daily = "daily",
	Weekly = "weekly",
	Monthly = "monthly",
	Yearly = "yearly",
	Custom = "custom",
}

export enum Weekday {
	Mon = "mon",
	Tue = "tue",
	Wed = "wed",
	Thu = "thu",
	Fri = "fri",
	Sat = "sat",
	Sun = "sun",
}

/** All seven weekdays in ISO order — frozen, safe to iterate. */
export const WEEKDAYS: readonly Weekday[] = Object.freeze([
	Weekday.Mon,
	Weekday.Tue,
	Weekday.Wed,
	Weekday.Thu,
	Weekday.Fri,
	Weekday.Sat,
	Weekday.Sun,
]);

/** Repeats every `every` days. `every >= 1`. */
export type DailyRecurrence = {
	kind: RecurrenceKind.Daily;
	every: number;
};

/** Repeats every `every` weeks on the listed `days`. `every >= 1`, `days`
 *  non-empty, each weekday at most once. */
export type WeeklyRecurrence = {
	kind: RecurrenceKind.Weekly;
	every: number;
	days: readonly Weekday[];
};

/** Repeats every `every` months. Exactly one of `dayOfMonth` (1..31) or
 *  `dayOfWeek` (e.g. "third Tuesday") must be set. `every >= 1`. */
export type MonthlyRecurrence = {
	kind: RecurrenceKind.Monthly;
	every: number;
	dayOfMonth?: number;
	dayOfWeek?: {
		weekday: Weekday;
		/** 1..4 = first..fourth, -1 = last. */
		ordinal: 1 | 2 | 3 | 4 | -1;
	};
};

/** Repeats yearly on `month` / `day`. `month 1..12`, `day 1..31` (callers
 *  must clamp for short months — Feb 29 → Feb 28 in non-leap years). */
export type YearlyRecurrence = {
	kind: RecurrenceKind.Yearly;
	month: number;
	day: number;
};

/** Opaque RFC 5545 RRULE string. Used when the structured forms cannot
 *  express the user's pattern (e.g. BYHOUR, BYSETPOS, multiple BYMONTH). */
export type CustomRecurrence = {
	kind: RecurrenceKind.Custom;
	rrule: string;
};

export type Recurrence =
	| DailyRecurrence
	| WeeklyRecurrence
	| MonthlyRecurrence
	| YearlyRecurrence
	| CustomRecurrence;

/** Type guard — narrows `unknown` to a structurally valid `Recurrence`.
 *  Used by Tasks + Calendar at the entity boundary so a malformed
 *  `Task.recurrence` field falls back to "no recurrence" rather than
 *  exploding the renderer. */
export function isRecurrence(value: unknown): value is Recurrence {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	switch (v.kind) {
		case RecurrenceKind.Daily:
			return typeof v.every === "number" && v.every >= 1 && Number.isFinite(v.every);
		case RecurrenceKind.Weekly: {
			if (typeof v.every !== "number" || v.every < 1 || !Number.isFinite(v.every)) return false;
			if (!Array.isArray(v.days) || v.days.length === 0) return false;
			const seen = new Set<string>();
			for (const d of v.days) {
				if (typeof d !== "string" || !WEEKDAYS.includes(d as Weekday)) return false;
				if (seen.has(d)) return false;
				seen.add(d);
			}
			return true;
		}
		case RecurrenceKind.Monthly: {
			if (typeof v.every !== "number" || v.every < 1 || !Number.isFinite(v.every)) return false;
			const hasDayOfMonth = typeof v.dayOfMonth === "number";
			const hasDayOfWeek = v.dayOfWeek !== undefined && v.dayOfWeek !== null;
			if (hasDayOfMonth === hasDayOfWeek) return false;
			if (hasDayOfMonth) {
				const d = v.dayOfMonth as number;
				return Number.isInteger(d) && d >= 1 && d <= 31;
			}
			const dow = v.dayOfWeek as Record<string, unknown>;
			if (typeof dow.weekday !== "string" || !WEEKDAYS.includes(dow.weekday as Weekday)) return false;
			const ord = dow.ordinal;
			return ord === 1 || ord === 2 || ord === 3 || ord === 4 || ord === -1;
		}
		case RecurrenceKind.Yearly: {
			const m = v.month;
			const d = v.day;
			return (
				typeof m === "number" &&
				Number.isInteger(m) &&
				m >= 1 &&
				m <= 12 &&
				typeof d === "number" &&
				Number.isInteger(d) &&
				d >= 1 &&
				d <= 31
			);
		}
		case RecurrenceKind.Custom:
			return typeof v.rrule === "string" && v.rrule.length > 0;
		default:
			return false;
	}
}
