/**
 * Calendar view — React component. Per `
 * §Calendar`.
 *
 * Today this is a thin React shell over the existing imperative
 * `renderCalendarView` (toolbar + week/month/year grids, recurrence
 * handling, day-drop semantics). The shell removes the
 * `ImperativeBridge` middleware: Calendar is a first-class React
 * component in the active-view tree, ready for incremental piece-by-
 * piece port (toolbar → cells → event pills) in follow-ups.
 *
 * The day-drop / select / open / range-change / nav callbacks pass
 * through unchanged — every interactive surface inside the calendar
 * still binds via the imperative renderer's listeners; React owns the
 * host div + dataset semantics. Re-paints on prop / cursor changes via
 * `<DomPaint>`'s deps array.
 */

import type { ReactElement } from "react";
import type { CompiledView } from "../logic/compile-view";
import type { EntityRow } from "../logic/in-memory-entities";
import { renderCalendarView } from "../render/calendar-view";
import type { CalendarLayoutOptions, CalendarRange, GroupBy } from "../types/list-view";
import { DomPaint } from "./dom-slot";

export type SelectionModifiers = { shiftKey: boolean; metaKey: boolean };

export type CalendarViewProps = {
	compiled: CompiledView;
	layout: CalendarLayoutOptions;
	groupBy: GroupBy;
	cursorMonth: number;
	selectedIds: ReadonlySet<string>;
	onSelect: (entity: EntityRow, modifiers: SelectionModifiers) => void;
	onOpen: (entity: EntityRow) => void;
	onPrev: () => void;
	onNext: () => void;
	onToday: () => void;
	onRangeChange: (range: CalendarRange) => void;
	onMoveToDay: (entity: EntityRow, dayStart: number) => void;
};

export function CalendarView(props: CalendarViewProps): ReactElement {
	return (
		<DomPaint
			paint={(host) => renderCalendarView(host, props)}
			deps={[
				props.compiled,
				props.layout,
				props.groupBy,
				props.cursorMonth,
				props.selectedIds,
				props.onSelect,
				props.onOpen,
				props.onPrev,
				props.onNext,
				props.onToday,
				props.onRangeChange,
				props.onMoveToDay,
			]}
		/>
	);
}
