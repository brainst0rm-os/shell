/**
 * `useGridCellKeyboard` — React hook twin of `attachGridCellKeyboard` /
 * `attachOrderedGridCellKeyboard`, for React grid surfaces (Calendar month
 * view). Mirrors the imperative helper: a `Orientation.Grid` composite over a
 * fixed `columns` count, container-holds-focus via `aria-activedescendant`
 * (the one-Tab-stop model), Enter/Space opens the active cell via
 * `onOpenCell`.
 *
 * Built on the shared `useCompositeKeyboard` (the same reducer + key tables
 * the imperative grid helper delegates to via `attachCompositeKeyboard`), so
 * the React + DOM grid surfaces can't drift. The host owns the cursor index
 * (`activeIndex` / `onActiveIndexChange`) the same way the imperative caller
 * owns its `cursor` closure.
 *
 * Returns `containerProps` to spread on the grid container and a per-cell
 * `getCellProps(index)` to spread on each cell element (in navigation order).
 * In-cell interactive elements (date buttons, event chips) stay
 * mouse-clickable but should carry `tabIndex={-1}` so the grid is one Tab
 * stop — the same demotion `attachOrderedGridCellKeyboard` does in DOM.
 */

import { Orientation } from "./orientation";
import {
	type CompositeContainerProps,
	type CompositeItemProps,
	useCompositeKeyboard,
} from "./use-composite-keyboard";

export type UseGridCellKeyboardOptions = {
	/** Fixed column count (7 for a month, the day count for a week grid). */
	columns: number;
	/** Total number of navigable cells. */
	count: number;
	/** The host-owned cursor cell index. */
	activeIndex: number;
	/** Cursor moved — the host updates its model + re-renders. */
	onActiveIndexChange: (index: number) => void;
	/** Open the active cell (Enter / Space). */
	onOpenCell: (index: number) => void;
};

export type UseGridCellKeyboardResult = {
	containerProps: CompositeContainerProps;
	getCellProps: (index: number) => CompositeItemProps;
};

export function useGridCellKeyboard(
	options: UseGridCellKeyboardOptions,
): UseGridCellKeyboardResult {
	const { containerProps, getItemProps } = useCompositeKeyboard({
		orientation: Orientation.Grid,
		columns: options.columns,
		count: options.count,
		activeIndex: options.activeIndex,
		onActiveIndexChange: options.onActiveIndexChange,
		onActivate: options.onOpenCell,
		useAriaActiveDescendant: true,
	});
	return { containerProps, getCellProps: getItemProps };
}
