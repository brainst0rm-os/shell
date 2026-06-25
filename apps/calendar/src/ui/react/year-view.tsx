/**
 * Year view (React) — a 12-month overview. Each month is a compact read-only
 * mini-grid whose days carry a busy-ness heat (no individual chips at this
 * zoom). Clicking a day jumps to its Day view; clicking a month header opens
 * that Month.
 */

import { t } from "../../i18n/t";
import type { CompiledYearView, YearDayCell, YearMonthCell } from "../../logic/compile-view";
import type { WeekStartsOn } from "../../types/calendar-view";
import { weekdayHeaderLabels } from "../format-date";
import type { ViewCallbacks } from "./view-callbacks";

export type YearViewProps = {
	compiled: CompiledYearView;
	weekStartsOn: WeekStartsOn;
	callbacks: Pick<ViewCallbacks, "onDayClick" | "onMonthOpen">;
};

function densityLevel(count: number): 0 | 1 | 2 | 3 {
	if (count <= 0) return 0;
	if (count <= 2) return 1;
	if (count <= 5) return 2;
	return 3;
}

export function YearView({ compiled, weekStartsOn, callbacks }: YearViewProps) {
	return (
		<section className="cal-year">
			{compiled.months.map((month) => (
				<MiniMonth
					key={month.monthIndex}
					month={month}
					weekStartsOn={weekStartsOn}
					onDayClick={callbacks.onDayClick}
					onMonthClick={callbacks.onMonthOpen}
				/>
			))}
		</section>
	);
}

function MiniMonth({
	month,
	weekStartsOn,
	onDayClick,
	onMonthClick,
}: {
	month: YearMonthCell;
	weekStartsOn: WeekStartsOn;
	onDayClick: ViewCallbacks["onDayClick"];
	onMonthClick: ViewCallbacks["onMonthOpen"];
}) {
	const monthName = new Date(month.monthStart).toLocaleDateString(undefined, { month: "long" });
	return (
		<div className="cal-year__month" {...(month.total > 0 ? { "data-has-items": "true" } : {})}>
			<button
				type="button"
				className="cal-year__month-head"
				aria-label={t("calendar.year.openMonth", { month: monthName })}
				onClick={() => onMonthClick(month.monthStart)}
			>
				{monthName}
			</button>
			<div className="cal-year__dow">
				{weekdayHeaderLabels(weekStartsOn).map((label, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: fixed 7-entry weekday header
					<span key={i} className="cal-year__dow-cell">
						{label.charAt(0)}
					</span>
				))}
			</div>
			<div className="cal-year__grid">
				{month.days.map((day, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: fixed 42-cell positional grid
					<YearDay key={i} day={day} onDayClick={onDayClick} />
				))}
			</div>
		</div>
	);
}

function YearDay({
	day,
	onDayClick,
}: { day: YearDayCell; onDayClick: ViewCallbacks["onDayClick"] }) {
	const dateLabel = new Date(day.dayStart).toLocaleDateString(undefined, {
		weekday: "long",
		day: "numeric",
		month: "long",
	});
	return (
		<button
			type="button"
			className="cal-year__day"
			data-density={String(densityLevel(day.count))}
			{...(day.isOtherMonth ? { "data-other-month": "true" } : {})}
			{...(day.isToday ? { "data-today": "true" } : {})}
			aria-label={t("calendar.year.dayLabel", { date: dateLabel, count: day.count })}
			onClick={() => onDayClick(day.dayStart)}
		>
			{day.dayOfMonth}
		</button>
	);
}
