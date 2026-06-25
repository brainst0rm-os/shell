/**
 * `useCompositeKeyboard` — DOM binding for the pure `composite-keyboard`
 * reducer. Maps DOM `keydown` to `CompositeKey`, owns the typeahead buffer,
 * stamps roving `tabindex` (or `aria-activedescendant`) onto the container
 * and items, and imperatively focuses the new active item.
 *
 * Per `61-keyboard-accessibility.md §The SDK surface`: this is the only hook
 * a list/grid/tablist/toolbar surface needs. Activate is observed before the
 * reducer runs (it returns unchanged state — the asymmetry is documented in
 * the `CompositeKey.Activate` JSDoc).
 */

import {
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { CompositeHost } from "./composite-host";
import { CompositeKey, compositeInit, compositeKey, compositeRoles } from "./composite-keyboard";
import { isPrintableChar, pickKeymap } from "./composite-keymap";
import { SelectionAttribute } from "./composite-selection";
import { Orientation } from "./orientation";
import type { SpatialCell } from "./spatial-grid";
import { type TypeaheadBuffer, createTypeaheadBuffer } from "./typeahead-buffer";

export type UseCompositeKeyboardOptions = {
	orientation: Orientation;
	count: number;
	activeIndex: number;
	onActiveIndexChange: (i: number) => void;
	onActivate?: (i: number) => void;
	wrap?: boolean;
	columns?: number;
	pageSize?: number;
	disabled?: ReadonlySet<number>;
	useAriaActiveDescendant?: boolean;
	/** Per spec §"The SDK surface": resolver from index → label string. The
	 *  hook owns the ≤500ms reset window via `createTypeaheadBuffer` and
	 *  consults this on each accumulated keystroke. */
	typeahead?: (i: number) => string;
	/** Optional fallback for virtualized callers: when the item at index `i`
	 *  isn't in the DOM, resolve it via this callback before focusing. */
	getElementForIndex?: (i: number) => HTMLElement | null;
	/** Override the container ARIA role the hook stamps (default: `grid` for
	 *  Grid orientation, else `listbox`). Use for a `tablist` / `toolbar` /
	 *  `radiogroup` composite — `itemRole` should be set to match. */
	role?: string;
	/** Override the item ARIA role (default: `gridcell` for Grid, else
	 *  `option`). Pairs with `role` (`tab` for a `tablist`, etc.). */
	itemRole?: string;
	/** Host element kind (default `Listbox`). `Combobox` is for a text input
	 *  that controls the list via `aria-activedescendant`: Space + Home/End +
	 *  Page keys fall through to the input for text editing, and only the
	 *  orientation arrows + Enter drive the list. */
	host?: CompositeHost;
	/** Which ARIA state attribute the active item carries (default
	 *  `AriaSelected`). Use `AriaChecked` for a `radiogroup`, `None` for a
	 *  `toolbar` whose items are plain buttons with no selected/checked state. */
	selectionAttribute?: SelectionAttribute;
	/** Required for `Orientation.Spatial`: the `{col, row}` cell of each item,
	 *  index-aligned with the composite, so arrow keys resolve to the nearest
	 *  item in that direction (macOS-Desktop style). Ignored otherwise. */
	cells?: ReadonlyArray<SpatialCell>;
	/** Delete / Backspace on the active item (the standard "remove this row"
	 *  list affordance, e.g. the Bin's purge). Keeps the raw key inside the hook
	 *  so call-sites stay `e.key`-free. Suppressed for a `Combobox` host, where
	 *  Backspace edits the input text. */
	onDelete?: (i: number) => void;
	/** Opt into a multi-select composite (e.g. the Bin's checkbox list). When
	 *  set, the container advertises `aria-multiselectable`, each item's
	 *  `aria-selected` reflects membership in `selectedIndices` (not the cursor),
	 *  and Space toggles the active item's membership via `onToggleSelect` while
	 *  Enter keeps activating. Single-select composites leave this off, where
	 *  Space === Activate and `aria-selected` tracks the cursor. */
	multiselectable?: boolean;
	/** The selected item indices, driving `aria-selected` when `multiselectable`.
	 *  Owned by the caller (selection lives outside the roving cursor). */
	selectedIndices?: ReadonlySet<number>;
	/** Space on the active item toggles its selection (multi-select only). */
	onToggleSelect?: (i: number) => void;
};

export type CompositeContainerProps = {
	ref: React.RefCallback<HTMLElement>;
	role: string;
	tabIndex: 0;
	"aria-activedescendant"?: string | undefined;
	"aria-orientation"?: "horizontal" | "vertical";
	"aria-multiselectable"?: boolean;
	onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
};

export type CompositeItemProps = {
	id: string;
	tabIndex: 0 | -1;
	"data-composite-index": number;
	/** Omitted for a `toolbar`, whose items are native controls that keep their
	 *  implicit role. */
	role?: string;
	"aria-selected"?: boolean;
	"aria-checked"?: boolean;
};

export type UseCompositeKeyboardResult = {
	containerProps: CompositeContainerProps;
	getItemProps: (index: number) => CompositeItemProps;
};

export function useCompositeKeyboard(
	options: UseCompositeKeyboardOptions,
): UseCompositeKeyboardResult {
	const {
		orientation,
		count,
		activeIndex,
		onActiveIndexChange,
		onActivate,
		wrap = true,
		columns,
		pageSize,
		disabled,
		useAriaActiveDescendant = false,
		typeahead,
		getElementForIndex,
		role,
		itemRole,
		host = CompositeHost.Listbox,
		selectionAttribute = SelectionAttribute.AriaSelected,
		cells,
		onDelete,
		multiselectable = false,
		selectedIndices,
		onToggleSelect,
	} = options;

	const { containerRole, itemRole: resolvedItemRole } = compositeRoles(orientation, role, itemRole);

	const containerRef = useRef<HTMLElement | null>(null);
	const itemIdPrefix = useId();

	// Reset / re-init the reducer only when the dimensions actually change —
	// every keypress runs through `compositeKey(state, key, ctx)` directly so
	// the controlled `activeIndex` from props stays the source of truth.
	const stateRef = useRef(
		compositeInit({
			orientation,
			count,
			activeIndex,
			...(columns !== undefined ? { columns } : {}),
			wrap,
			...(pageSize !== undefined ? { pageSize } : {}),
		}),
	);
	useEffect(() => {
		stateRef.current = compositeInit({
			orientation,
			count,
			activeIndex,
			...(columns !== undefined ? { columns } : {}),
			wrap,
			...(pageSize !== undefined ? { pageSize } : {}),
		});
	}, [orientation, count, activeIndex, columns, wrap, pageSize]);

	// Stabilise the host's typeahead resolver via a ref so the buffer can be
	// memoised by *presence* of typeahead, not by identity. Inline-arrow
	// callers (`<List typeahead={(i) => labels[i]} />`) recreate the resolver
	// every render; without the ref the buffer would be torn down on every
	// re-render and the 500ms accumulation window would never accumulate.
	const typeaheadRef = useRef(typeahead);
	useEffect(() => {
		typeaheadRef.current = typeahead;
	}, [typeahead]);

	const hasTypeahead = typeahead !== undefined;
	const typeaheadBuffer = useMemo<TypeaheadBuffer | null>(
		() =>
			hasTypeahead
				? createTypeaheadBuffer({
						count: () => stateRef.current.count,
						getLabel: (i) => typeaheadRef.current?.(i) ?? "",
					})
				: null,
		[hasTypeahead],
	);

	const focusItem = useCallback(
		(index: number) => {
			if (useAriaActiveDescendant) return;
			const container = containerRef.current;
			if (container === null) return;
			const fromDom = container.querySelector<HTMLElement>(`[data-composite-index="${index}"]`);
			const target = fromDom ?? getElementForIndex?.(index) ?? null;
			target?.focus();
		},
		[useAriaActiveDescendant, getElementForIndex],
	);

	const lastEmitRef = useRef(activeIndex);
	useEffect(() => {
		lastEmitRef.current = activeIndex;
	}, [activeIndex]);

	// `cells` (spatial positions) flow through a ref so a reflow (icons moving)
	// doesn't recreate `dispatchKey`; the reducer reads them at dispatch time.
	const cellsRef = useRef(cells);
	useEffect(() => {
		cellsRef.current = cells;
	}, [cells]);

	const dispatchKey = useCallback(
		(key: CompositeKey, ctx?: { typeaheadIndex?: number }) => {
			const prev = stateRef.current;
			const ctxArg: {
				disabled?: ReadonlySet<number>;
				typeaheadIndex?: number;
				cells?: ReadonlyArray<SpatialCell>;
			} = {
				...(disabled !== undefined ? { disabled } : {}),
				...(ctx?.typeaheadIndex !== undefined ? { typeaheadIndex: ctx.typeaheadIndex } : {}),
				...(cellsRef.current !== undefined ? { cells: cellsRef.current } : {}),
			};
			const next = compositeKey(prev, key, ctxArg);
			if (next.activeIndex !== prev.activeIndex) {
				stateRef.current = next;
				lastEmitRef.current = next.activeIndex;
				onActiveIndexChange(next.activeIndex);
				focusItem(next.activeIndex);
			}
		},
		[disabled, onActiveIndexChange, focusItem],
	);

	const onKeyDown = useCallback(
		(e: ReactKeyboardEvent<HTMLElement>) => {
			// Only handle keys originating from the composite itself or one of its
			// items — never from an unrelated focusable child of the container (e.g.
			// a tablist's trailing action button). Without this, that child's
			// Enter/Space would be preventDefaulted (its activation swallowed) and
			// arrows would hijack the composite's cursor. The combobox host puts
			// `onKeyDown` on the input, where `target === currentTarget`, so it stays
			// handled.
			const target = e.target as Element | null;
			if (
				target !== e.currentTarget &&
				(target === null || target.closest("[data-composite-index]") === null)
			) {
				return;
			}
			// Multi-select: Space toggles the active item's membership in the
			// selection set (Enter still activates). Gated on `multiselectable` so
			// single-select composites keep Space === Activate below. preventDefault
			// stops the page scrolling; autorepeat is ignored.
			if (
				multiselectable &&
				onToggleSelect !== undefined &&
				e.key === " " &&
				host !== CompositeHost.Combobox
			) {
				e.preventDefault();
				if (e.repeat) return;
				if (activeIndex >= 0) onToggleSelect(activeIndex);
				return;
			}
			// Activate keys (Enter / Space): preventDefault unconditionally so a
			// composite container with no current selection doesn't let Space
			// scroll the page; ignore autorepeat so a held key doesn't fire
			// `onActivate` 30×/s. The reducer is a no-op on Activate by design
			// — see `CompositeKey.Activate` JSDoc.
			if (e.key === "Enter" || (e.key === " " && host !== CompositeHost.Combobox)) {
				e.preventDefault();
				if (e.repeat) return;
				if (activeIndex >= 0) onActivate?.(activeIndex);
				return;
			}
			// Delete / Backspace removes the active item (opt-in). Suppressed for a
			// Combobox host, where Backspace edits the input text.
			if (
				onDelete !== undefined &&
				host !== CompositeHost.Combobox &&
				(e.key === "Delete" || e.key === "Backspace")
			) {
				if (activeIndex < 0) return;
				e.preventDefault();
				if (e.repeat) return;
				onDelete(activeIndex);
				return;
			}
			const keymap = pickKeymap(orientation, host);
			const mapped = keymap[e.key];
			if (mapped !== undefined) {
				e.preventDefault();
				dispatchKey(mapped);
				return;
			}
			// Typeahead path: accumulate into the buffer (≤500ms reset window)
			// and dispatch the resolved index. The buffer owns prefix-cycle
			// semantics — see `typeahead-buffer.ts`.
			if (
				typeaheadBuffer !== null &&
				isPrintableChar({
					key: e.key,
					ctrlKey: e.ctrlKey,
					metaKey: e.metaKey,
					altKey: e.altKey,
					keyCode: e.keyCode,
					isComposing: e.nativeEvent.isComposing,
				})
			) {
				const result = typeaheadBuffer.append(e.key, stateRef.current.activeIndex);
				if (result.index !== null && result.index >= 0) {
					e.preventDefault();
					dispatchKey(CompositeKey.Typeahead, { typeaheadIndex: result.index });
				}
			}
		},
		[
			orientation,
			host,
			activeIndex,
			onActivate,
			onDelete,
			dispatchKey,
			typeaheadBuffer,
			multiselectable,
			onToggleSelect,
		],
	);

	const setContainer = useCallback<React.RefCallback<HTMLElement>>((node) => {
		containerRef.current = node;
	}, []);

	const containerProps = useMemo<CompositeContainerProps>(() => {
		const ariaOrientation: "horizontal" | "vertical" | undefined =
			orientation === Orientation.Horizontal
				? "horizontal"
				: orientation === Orientation.Vertical
					? "vertical"
					: undefined;
		const base: CompositeContainerProps = {
			ref: setContainer,
			role: containerRole,
			tabIndex: 0,
			onKeyDown,
			...(ariaOrientation !== undefined ? { "aria-orientation": ariaOrientation } : {}),
			...(multiselectable ? { "aria-multiselectable": true } : {}),
		};
		if (useAriaActiveDescendant) {
			base["aria-activedescendant"] =
				activeIndex >= 0 && activeIndex < count ? `${itemIdPrefix}-${activeIndex}` : undefined;
		}
		return base;
	}, [
		orientation,
		containerRole,
		setContainer,
		onKeyDown,
		useAriaActiveDescendant,
		activeIndex,
		count,
		itemIdPrefix,
		multiselectable,
	]);

	const getItemProps = useCallback(
		(index: number): CompositeItemProps => {
			const isActive = index === activeIndex;
			const base: CompositeItemProps = {
				id: `${itemIdPrefix}-${index}`,
				tabIndex: useAriaActiveDescendant ? -1 : isActive ? 0 : -1,
				"data-composite-index": index,
			};
			if (resolvedItemRole !== undefined) base.role = resolvedItemRole;
			if (selectionAttribute === SelectionAttribute.AriaSelected) {
				// In multi-select, `aria-selected` reflects the selection set; the
				// cursor is conveyed by roving tabindex / activedescendant instead.
				base["aria-selected"] = multiselectable ? (selectedIndices?.has(index) ?? false) : isActive;
			} else if (selectionAttribute === SelectionAttribute.AriaChecked) {
				base["aria-checked"] = isActive;
			}
			return base;
		},
		[
			itemIdPrefix,
			resolvedItemRole,
			useAriaActiveDescendant,
			activeIndex,
			selectionAttribute,
			multiselectable,
			selectedIndices,
		],
	);

	return { containerProps, getItemProps };
}
