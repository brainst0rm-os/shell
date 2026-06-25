/**
 * View compilers — turn a flat `ScheduledItem[]` into the shape each
 * Calendar view kind expects.
 *
 * **Long-term keystone** per [[preview-drop-pattern]]: the renderer
 * never sees raw item lists or builds its own layout math. Compilers
 * own all date-bucketing + overflow-cap-aware sorting + range
 * intersection logic. The 9.3 entities-service swap only changes the
 * input source.
 */

import type { TKey } from "../i18n/t";
import { CalendarViewKind, type WeekStartsOn } from "../types/calendar-view";
import {
	addDays,
	dateKey,
	daysBetween,
	endOfDay,
	endOfMonthGrid,
	endOfWeek,
	monthGridDays,
	startOfDay,
	startOfMonthGrid,
	startOfWeek,
	weekDays,
} from "./date-range";
import { expandRecurringItems } from "./expand-recurring";
import { type ScheduledItem, finalInstant } from "./scheduled-item";

/** A single day cell in the Month view's 6×7 grid. */
export type MonthDayCell = {
	dayStart: number; // 00:00 local
	dateKey: string;
	dayOfMonth: number; // 1..31
	isOtherMonth: boolean;
	isToday: boolean;
	isWeekend: boolean;
	allDayItems: ScheduledItem[];
	timedItems: ScheduledItem[];
};

export type CompiledMonthView = {
	kind: CalendarViewKind.Month;
	rangeStart: number;
	rangeEnd: number;
	cells: MonthDayCell[]; // length 42, row-major (week 1..6)
};

export type WeekDayBucket = {
	dayStart: number;
	dateKey: string;
	isToday: boolean;
	isWeekend: boolean;
	allDayItems: ScheduledItem[];
	timedItems: ScheduledItem[];
};

export type CompiledWeekView = {
	kind: CalendarViewKind.Week;
	rangeStart: number;
	rangeEnd: number;
	days: WeekDayBucket[]; // length 7
};

export type CompiledDayView = {
	kind: CalendarViewKind.Day;
	rangeStart: number;
	rangeEnd: number;
	day: WeekDayBucket;
};

export enum AgendaBucketKey {
	Today = "today",
	Tomorrow = "tomorrow",
	ThisWeek = "this-week",
	Later = "later",
}

export type AgendaBucket = {
	key: AgendaBucketKey;
	headingKey: TKey;
	items: ScheduledItem[]; // ordered by start asc
};

export type CompiledAgendaView = {
	kind: CalendarViewKind.Agenda;
	rangeStart: number;
	rangeEnd: number;
	buckets: AgendaBucket[]; // empty buckets dropped
};

/** A single day in a Year-view mini-month grid (9.15.11). Carries only a
 *  density `count` — the year overview shows how busy each day is, not the
 *  individual items. */
export type YearDayCell = {
	dayStart: number;
	dayOfMonth: number;
	isOtherMonth: boolean;
	isToday: boolean;
	count: number;
};

export type YearMonthCell = {
	monthIndex: number; // 0..11
	monthStart: number;
	days: YearDayCell[]; // 42, row-major
	total: number; // items landing in this month
};

export type CompiledYearView = {
	kind: CalendarViewKind.Year;
	year: number;
	rangeStart: number;
	rangeEnd: number;
	months: YearMonthCell[]; // length 12
};

export type CompiledView =
	| CompiledMonthView
	| CompiledWeekView
	| CompiledDayView
	| CompiledAgendaView
	| CompiledYearView;

export type CompileOptions = {
	anchor: number;
	weekStartsOn: WeekStartsOn;
	showWeekends?: boolean;
	now: number;
};

export function compileMonthView(
	rawItems: readonly ScheduledItem[],
	options: CompileOptions,
): CompiledMonthView {
	const start = startOfMonthGrid(options.anchor, options.weekStartsOn);
	const end = endOfMonthGrid(options.anchor, options.weekStartsOn);
	const items = expandRecurringItems(rawItems, start, end);
	const days = monthGridDays(options.anchor, options.weekStartsOn);
	const today = dateKey(options.now);
	const anchorMonth = new Date(options.anchor).getMonth();
	const cells: MonthDayCell[] = days.map((dayStart) => {
		const date = new Date(dayStart);
		const allDay: ScheduledItem[] = [];
		const timed: ScheduledItem[] = [];
		for (const item of items) {
			if (!intersectsDay(item, dayStart)) continue;
			if (item.allDay || isMultiDay(item)) allDay.push(item);
			else timed.push(item);
		}
		allDay.sort(spanFirstThenStart);
		timed.sort((a, b) => a.start - b.start);
		const dow = date.getDay();
		return {
			dayStart,
			dateKey: dateKey(dayStart),
			dayOfMonth: date.getDate(),
			isOtherMonth: date.getMonth() !== anchorMonth,
			isToday: dateKey(dayStart) === today,
			isWeekend: dow === 0 || dow === 6,
			allDayItems: allDay,
			timedItems: timed,
		};
	});
	return { kind: CalendarViewKind.Month, rangeStart: start, rangeEnd: end, cells };
}

export function compileWeekView(
	rawItems: readonly ScheduledItem[],
	options: CompileOptions,
): CompiledWeekView {
	const start = startOfWeek(options.anchor, options.weekStartsOn);
	const end = endOfWeek(options.anchor, options.weekStartsOn);
	const items = expandRecurringItems(rawItems, start, end);
	const days = weekDays(options.anchor, options.weekStartsOn);
	const today = dateKey(options.now);
	const buckets: WeekDayBucket[] = days.map((dayStart) => buildDayBucket(items, dayStart, today));
	return { kind: CalendarViewKind.Week, rangeStart: start, rangeEnd: end, days: buckets };
}

export function compileDayView(
	rawItems: readonly ScheduledItem[],
	options: CompileOptions,
): CompiledDayView {
	const start = startOfDay(options.anchor);
	const end = endOfDay(options.anchor);
	const items = expandRecurringItems(rawItems, start, end);
	const today = dateKey(options.now);
	const day = buildDayBucket(items, start, today);
	return { kind: CalendarViewKind.Day, rangeStart: start, rangeEnd: end, day };
}

export function compileAgendaView(
	rawItems: readonly ScheduledItem[],
	options: CompileOptions,
): CompiledAgendaView {
	const todayStart = startOfDay(options.now);
	const tomorrowStart = addDays(todayStart, 1);
	const dayAfterTomorrow = addDays(todayStart, 2);
	const weekEnd = endOfDay(addDays(todayStart, 6));
	const rangeEnd = endOfDay(addDays(todayStart, 30));
	const items = expandRecurringItems(rawItems, todayStart, rangeEnd);

	// The Agenda is the forward-looking "what's coming up" list, so a completed
	// task is dropped here (it stays on the Month/Week/Day grids as history) —
	// a done follow-up shouldn't read as still-upcoming (F-028).
	const upcoming = items.filter(
		(i) => !i.done && finalInstant(i) >= todayStart && i.start <= rangeEnd,
	);
	upcoming.sort((a, b) => a.start - b.start);

	const today: ScheduledItem[] = [];
	const tomorrow: ScheduledItem[] = [];
	const thisWeek: ScheduledItem[] = [];
	const later: ScheduledItem[] = [];

	for (const item of upcoming) {
		if (intersectsDay(item, todayStart)) {
			today.push(item);
			continue;
		}
		if (intersectsDay(item, tomorrowStart)) {
			tomorrow.push(item);
			continue;
		}
		if (item.start < weekEnd) {
			thisWeek.push(item);
			continue;
		}
		later.push(item);
	}

	const buckets: AgendaBucket[] = [];
	if (today.length > 0) {
		buckets.push({
			key: AgendaBucketKey.Today,
			headingKey: "calendar.agenda.heading.today",
			items: today,
		});
	}
	if (tomorrow.length > 0) {
		buckets.push({
			key: AgendaBucketKey.Tomorrow,
			headingKey: "calendar.agenda.heading.tomorrow",
			items: tomorrow,
		});
	}
	if (thisWeek.length > 0) {
		buckets.push({
			key: AgendaBucketKey.ThisWeek,
			headingKey: "calendar.agenda.heading.thisWeek",
			items: thisWeek,
		});
	}
	if (later.length > 0) {
		buckets.push({
			key: AgendaBucketKey.Later,
			headingKey: "calendar.agenda.heading.later",
			items: later,
		});
	}

	void dayAfterTomorrow;
	return { kind: CalendarViewKind.Agenda, rangeStart: todayStart, rangeEnd, buckets };
}

export function compileYearView(
	rawItems: readonly ScheduledItem[],
	options: CompileOptions,
): CompiledYearView {
	const year = new Date(options.anchor).getFullYear();
	const rangeStart = new Date(year, 0, 1).getTime();
	const rangeEnd = endOfDay(new Date(year, 11, 31).getTime());
	const items = expandRecurringItems(rawItems, rangeStart, rangeEnd);

	// Density per day: each item bumps every day it touches within the year.
	const countByKey = new Map<string, number>();
	for (const item of items) {
		const firstDay = startOfDay(Math.max(item.start, rangeStart));
		const lastDay = startOfDay(Math.min(finalInstant(item), rangeEnd));
		for (let day = firstDay; day <= lastDay; day = addDays(day, 1)) {
			const key = dateKey(day);
			countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
		}
	}

	const todayKey = dateKey(options.now);
	const months: YearMonthCell[] = [];
	for (let m = 0; m < 12; m++) {
		const monthStart = new Date(year, m, 1).getTime();
		const gridDays = monthGridDays(monthStart, options.weekStartsOn);
		let total = 0;
		const days: YearDayCell[] = gridDays.map((dayStart) => {
			const date = new Date(dayStart);
			const isOtherMonth = date.getMonth() !== m;
			const count = countByKey.get(dateKey(dayStart)) ?? 0;
			if (!isOtherMonth) total += count;
			return {
				dayStart,
				dayOfMonth: date.getDate(),
				isOtherMonth,
				isToday: dateKey(dayStart) === todayKey,
				count,
			};
		});
		months.push({ monthIndex: m, monthStart, days, total });
	}

	return { kind: CalendarViewKind.Year, year, rangeStart, rangeEnd, months };
}

function buildDayBucket(
	items: readonly ScheduledItem[],
	dayStart: number,
	todayKey: string,
): WeekDayBucket {
	const allDay: ScheduledItem[] = [];
	const timed: ScheduledItem[] = [];
	for (const item of items) {
		if (!intersectsDay(item, dayStart)) continue;
		if (item.allDay || isMultiDay(item)) allDay.push(item);
		else timed.push(item);
	}
	allDay.sort(spanFirstThenStart);
	timed.sort((a, b) => a.start - b.start);
	const dow = new Date(dayStart).getDay();
	return {
		dayStart,
		dateKey: dateKey(dayStart),
		isToday: dateKey(dayStart) === todayKey,
		isWeekend: dow === 0 || dow === 6,
		allDayItems: allDay,
		timedItems: timed,
	};
}

function intersectsDay(item: ScheduledItem, dayStart: number): boolean {
	const dayEnd = endOfDay(dayStart);
	const last = finalInstant(item);
	return item.start <= dayEnd && last >= dayStart;
}

function isMultiDay(item: ScheduledItem): boolean {
	return isMultiDayItem(item);
}

/** A timed or all-day item whose span crosses at least one local
 *  midnight — the Month view paints these as cross-cell ribbons (9.15.20)
 *  rather than a repeated per-day chip. */
export function isMultiDayItem(item: ScheduledItem): boolean {
	if (item.end === null) return false;
	return daysBetween(item.start, item.end) >= 1;
}

/** Span items first (so the renderer can stack them as ribbons across
 *  the top), then single-day all-day, then by start. */
function spanFirstThenStart(a: ScheduledItem, b: ScheduledItem): number {
	const aSpan = isMultiDay(a) ? 0 : 1;
	const bSpan = isMultiDay(b) ? 0 : 1;
	if (aSpan !== bSpan) return aSpan - bSpan;
	return a.start - b.start;
}
