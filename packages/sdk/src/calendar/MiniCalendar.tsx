/**
 * React twin of `createMiniCalendar` — compact date-picker: MonthGrid +
 * title + DatePager prev/next, same `.bs-cal-mini__*` chrome as the
 * imperative helper. React apps (Calendar sidebar) render through this.
 *
 * Controlled: the host owns `valueMs` (selected date) and `viewMs` (shown
 * month) and updates them from `onChange` / `onViewChange`. `viewMs` is
 * optional — when omitted the component tracks the shown month internally
 * (uncontrolled view), seeded from `valueMs ?? todayMs`.
 */

import { type ReactNode, useState } from "react";
import { type WeekStartsOn, addMonths } from "../date-grid/date-grid";
import { DatePager } from "../date-pager/DatePager";
import { MonthGrid, type MonthGridReactCell } from "./MonthGrid";
import type { MiniCalendarLabels } from "./mini-calendar";
import { defaultMiniWeekdays } from "./mini-weekdays";
import { MonthGridDensity } from "./month-grid";

export type MiniCalendarProps = {
	labels: MiniCalendarLabels;
	/** Currently-selected date. `null` = nothing selected. */
	valueMs?: number | null;
	/** Which month is shown (controlled). When omitted the view is tracked
	 *  internally, seeded from `valueMs ?? todayMs`. */
	viewMs?: number;
	/** Anchor for the "today" highlight. Defaults to `Date.now()`. */
	todayMs?: number;
	weekStartsOn?: WeekStartsOn;
	/** Custom weekday short labels (7 entries). Defaults to the first letter
	 *  of each locale weekday — typical mini-calendar density. */
	weekdayLabels?: ReadonlyArray<string>;
	/** Override the title text. Default `toLocaleDateString({ month, year })`. */
	formatTitle?(viewMs: number): string;
	/** When set, the title renders as a button that calls this with the shown
	 *  month (epoch ms) — hosts open a month/year jump picker from it. The
	 *  passed `element` is the title button, ready to anchor a menu/popover. */
	onTitleClick?(viewMs: number, element: HTMLElement): void;
	className?: string;
	/** Render the title + prev/next header. Default `true`. */
	showHeader?: boolean;
	/** Returns the content node for each day cell (e.g. an entry-presence dot). */
	renderCell?(cell: MonthGridReactCell): ReactNode;
	/** Fired when a day is picked (date click or "Today"). */
	onChange?(epochMs: number): void;
	/** Fired when the shown month changes (prev / next / today). */
	onViewChange?(viewMs: number): void;
};

export function MiniCalendar({
	labels,
	valueMs,
	viewMs,
	todayMs,
	weekStartsOn,
	weekdayLabels,
	formatTitle,
	onTitleClick,
	className,
	showHeader = true,
	renderCell,
	onChange,
	onViewChange,
}: MiniCalendarProps) {
	const today = todayMs ?? Date.now();
	const value = valueMs ?? null;

	const [internalView, setInternalView] = useState<number>(viewMs ?? value ?? today);
	const view = viewMs ?? internalView;

	const setView = (next: number): void => {
		if (viewMs === undefined) setInternalView(next);
		onViewChange?.(next);
	};

	const stepMonth = (delta: number): void => setView(addMonths(view, delta));

	const goToday = (): void => {
		setView(today);
		onChange?.(today);
	};

	const title = formatTitle
		? formatTitle(view)
		: new Date(view).toLocaleDateString(undefined, { month: "long", year: "numeric" });

	const rootClass = className ? `bs-cal-mini ${className}` : "bs-cal-mini";
	const labelsForWeekdays = weekdayLabels ?? defaultMiniWeekdays(weekStartsOn);

	return (
		<section className={rootClass}>
			{showHeader ? (
				<div className="bs-cal-mini__header">
					<DatePager
						labels={{ today: labels.today, prev: labels.prev, next: labels.next }}
						onToday={goToday}
						onPrev={() => stepMonth(-1)}
						onNext={() => stepMonth(1)}
						className="bs-cal-mini__pager"
						iconSize={14}
					/>
					{onTitleClick ? (
						<button
							type="button"
							className="bs-cal-mini__title bs-cal-mini__title--button"
							aria-haspopup="menu"
							onClick={(ev) => onTitleClick(view, ev.currentTarget)}
						>
							{title}
						</button>
					) : (
						<span className="bs-cal-mini__title">{title}</span>
					)}
				</div>
			) : null}
			<div className="bs-cal-mini__body">
				<MonthGrid
					focusMs={view}
					todayMs={today}
					selectedMs={value}
					density={MonthGridDensity.Compact}
					weekdayLabels={labelsForWeekdays}
					{...(weekStartsOn !== undefined ? { weekStartsOn } : {})}
					{...(renderCell !== undefined ? { renderCell } : {})}
					onDateClick={(cell) => onChange?.(cell.dateEpochMs)}
				/>
			</div>
		</section>
	);
}
