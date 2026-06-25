/**
 * `useVirtualGridNav` — arrow-key navigation for a ROW-VIRTUALIZED grid
 * (KBN-S-pickers, 12.4). The icon/cover pickers' grids render thousands of
 * cells through `@tanstack/react-virtual`, so a roving-tabindex composite
 * can't work: the active cell may not be mounted. This binds the shared
 * `useCompositeKeyboard` reducer in `aria-activedescendant` mode instead —
 * DOM focus stays on the scroll container (one Tab stop for the whole grid),
 * the cursor is conveyed by `aria-activedescendant` + `aria-selected`, and
 * the caller scrolls the cursor's row into view so the referenced cell is
 * always mounted by the time AT resolves the id.
 *
 * `buildVirtualGridModel` is the pure half: it flattens labelled sections
 * into the flat item order the Grid reducer navigates (row-major over
 * `cellsPerRow` columns), the virtualizer's row list (headers interleaved),
 * and the item→row mapping the scroll-into-view needs. Unit-tested without
 * a DOM; the mounted behaviour is covered by the KBN-P picker-grid spec
 * (virtualized grids render empty under jsdom).
 */

import { useMemo, useState } from "react";
import { Orientation } from "./orientation";
import {
	type CompositeContainerProps,
	type CompositeItemProps,
	useCompositeKeyboard,
} from "./use-composite-keyboard";

export enum VirtualGridRowKind {
	Header = "header",
	Cells = "cells",
}

export type VirtualGridSection<T> = {
	/** Stable key prefix for the section's rows. */
	key: string;
	/** Section heading text; null renders no header row (flat results). */
	label: string | null;
	items: readonly T[];
};

export type VirtualGridRow<T> =
	| { kind: VirtualGridRowKind.Header; key: string; label: string }
	| { kind: VirtualGridRowKind.Cells; key: string; start: number; items: readonly T[] };

export type VirtualGridModel<T> = {
	/** All items flattened in navigation order (row-major). */
	items: readonly T[];
	/** Virtualizer rows: section headers interleaved with cell rows. */
	rows: readonly VirtualGridRow<T>[];
	/** Item index → index into `rows` (for scroll-into-view). */
	rowOfItem: readonly number[];
};

export function buildVirtualGridModel<T>(
	sections: readonly VirtualGridSection<T>[],
	cellsPerRow: number,
): VirtualGridModel<T> {
	const perRow = Math.max(1, cellsPerRow);
	const items: T[] = [];
	const rows: VirtualGridRow<T>[] = [];
	const rowOfItem: number[] = [];
	for (const section of sections) {
		if (section.label !== null && section.items.length > 0) {
			rows.push({ kind: VirtualGridRowKind.Header, key: `h:${section.key}`, label: section.label });
		}
		for (let i = 0; i < section.items.length; i += perRow) {
			const slice = section.items.slice(i, i + perRow);
			const rowIndex = rows.length;
			rows.push({
				kind: VirtualGridRowKind.Cells,
				key: `${section.key}:${i}`,
				start: items.length,
				items: slice,
			});
			for (let j = 0; j < slice.length; j += 1) rowOfItem.push(rowIndex);
			items.push(...slice);
		}
	}
	return { items, rows, rowOfItem };
}

export type UseVirtualGridNavResult<T> = {
	rows: readonly VirtualGridRow<T>[];
	/** Spread onto the scroll container. Carries `role="grid"`, `tabIndex: 0`,
	 *  `aria-activedescendant` and the arrow-key handler. Its `ref` must be
	 *  composed with the virtualizer's scroll-element ref by the caller. */
	containerProps: CompositeContainerProps;
	/** Props for the cell at a FLAT item index (`row.start + offsetInRow`). */
	getCellProps: (index: number) => CompositeItemProps;
	/** Row index (into `rows`) holding the cursor — scroll it into view. */
	activeRow: number | null;
};

export function useVirtualGridNav<T>(
	sections: readonly VirtualGridSection<T>[],
	cellsPerRow: number,
	onPick: (item: T) => void,
): UseVirtualGridNavResult<T> {
	const { items, rows, rowOfItem } = useMemo(
		() => buildVirtualGridModel(sections, cellsPerRow),
		[sections, cellsPerRow],
	);

	// The cursor clamps rather than resets when the item list shrinks (a
	// narrowing search keeps the cursor in range without a jarring jump to 0).
	const [cursor, setCursor] = useState(0);
	const activeIndex = items.length === 0 ? -1 : Math.min(cursor, items.length - 1);

	const { containerProps, getItemProps } = useCompositeKeyboard({
		orientation: Orientation.Grid,
		count: items.length,
		columns: Math.max(1, cellsPerRow),
		activeIndex,
		onActiveIndexChange: setCursor,
		onActivate: (i) => {
			const item = items[i];
			if (item !== undefined) onPick(item);
		},
		useAriaActiveDescendant: true,
	});

	const activeRow = activeIndex >= 0 ? (rowOfItem[activeIndex] ?? null) : null;
	return { rows, containerProps, getCellProps: getItemProps, activeRow };
}
