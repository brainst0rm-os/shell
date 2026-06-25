/**
 * `attachCompositeKeyboard` — the framework-agnostic DOM binding for the pure
 * `composite-keyboard` reducer, the non-React sibling of `useCompositeKeyboard`.
 * DOM-imperative apps (theme-editor, whiteboard, graph, …) render their own
 * rows, so this binding wires a `keydown` listener on the container, stamps the
 * container + item ARIA (role / roving tabindex or `aria-activedescendant` /
 * `aria-selected`), and drives the reducer; the caller owns the cursor value
 * and re-renders, then calls `refresh()` to re-stamp.
 *
 * Shares the key tables + reducer with the React hook (see `composite-keymap.ts`),
 * so the two surfaces can't drift. Multi-select is intentionally omitted — the
 * DOM surfaces that need it are not in scope; add it here if one arrives.
 */

import { CompositeHost } from "./composite-host";
import {
	CompositeKey,
	type CompositeState,
	compositeInit,
	compositeKey,
	compositeRoles,
} from "./composite-keyboard";
import { isPrintableChar, pickKeymap } from "./composite-keymap";
import { SelectionAttribute } from "./composite-selection";
import { Orientation } from "./orientation";
import type { SpatialCell } from "./spatial-grid";
import { type TypeaheadBuffer, createTypeaheadBuffer } from "./typeahead-buffer";

export type AttachCompositeKeyboardOptions = {
	orientation: Orientation;
	/** Live item count (read on every keypress — DOM lists grow / shrink). */
	count: () => number;
	/** The caller-owned cursor index (read on every keypress). */
	activeIndex: () => number;
	/** Cursor moved — the caller updates its model + re-renders, then the binding
	 *  re-stamps via `refresh()`. */
	onActiveIndexChange: (index: number) => void;
	/** Enter / Space on the active item. */
	onActivate?: (index: number) => void;
	/** Delete / Backspace on the active item (suppressed for a Combobox host). */
	onDelete?: (index: number) => void;
	wrap?: boolean;
	/** Grid column count (read live). */
	columns?: () => number;
	/** Per-item `{col, row}` cells for `Orientation.Spatial` (read on every
	 *  keypress — DOM lists grow / shrink). Aligns by `data-composite-index`; the
	 *  directional keys resolve via `spatialGridStep`. The DOM mirror of the React
	 *  hook's `cells` prop (used by the dashboard icon grid). */
	cells?: () => ReadonlyArray<SpatialCell>;
	pageSize?: number;
	/** Indices the reducer must skip (e.g. interleaved section headers). */
	disabled?: () => ReadonlySet<number>;
	/** Container holds focus + `aria-activedescendant` instead of roving real
	 *  focus onto items — required for a virtualized list whose active row may
	 *  be unmounted. */
	useAriaActiveDescendant?: boolean;
	/** index → label, for type-ahead (owns the ≤500ms accumulation window). */
	typeahead?: (index: number) => string;
	/** Override the container ARIA role (default `grid` for Grid, else `listbox`). */
	role?: string;
	/** Override the item ARIA role (default `gridcell` for Grid, else `option`). */
	itemRole?: string;
	host?: CompositeHost;
	selectionAttribute?: SelectionAttribute;
	/** CSS selector for the item elements within the container. They MUST carry
	 *  `data-composite-index="<i>"`. Default `[data-composite-index]`. */
	itemSelector?: string;
	/** Stable id prefix for `aria-activedescendant` wiring. Auto-generated when
	 *  omitted. */
	idPrefix?: string;
	/** The element the `keydown` listener attaches to (default: the container).
	 *  For an input-driven combobox (`host: Combobox`) the search `<input>` keeps
	 *  DOM focus while a separate list `container` is navigated, so the listener
	 *  lives on the input and `aria-activedescendant` is stamped there — mirroring
	 *  how the React `useCompositeKeyboard` Combobox spreads `onKeyDown` +
	 *  `aria-activedescendant` onto its input. */
	keyboardTarget?: HTMLElement;
};

export type CompositeKeyboardHandle = {
	/** Re-stamp the container + items from the current `count` / `activeIndex`.
	 *  Call after the caller re-renders rows. */
	refresh(): void;
	destroy(): void;
};

let idCounter = 0;

export function attachCompositeKeyboard(
	container: HTMLElement,
	options: AttachCompositeKeyboardOptions,
): CompositeKeyboardHandle {
	const {
		orientation,
		count,
		activeIndex,
		onActiveIndexChange,
		onActivate,
		onDelete,
		wrap = true,
		columns,
		cells,
		pageSize,
		disabled,
		useAriaActiveDescendant = false,
		typeahead,
		role,
		itemRole,
		host = CompositeHost.Listbox,
		selectionAttribute = SelectionAttribute.AriaSelected,
		itemSelector = "[data-composite-index]",
		idPrefix,
		keyboardTarget,
	} = options;

	// For a combobox the input owns focus + `aria-activedescendant`; otherwise the
	// container is both the key sink and the activedescendant host.
	const kbTarget = keyboardTarget ?? container;

	const { containerRole, itemRole: resolvedItemRole } = compositeRoles(orientation, role, itemRole);
	idCounter += 1;
	const prefix = idPrefix ?? `bs-composite-${idCounter}`;

	const buffer: TypeaheadBuffer | null = typeahead
		? createTypeaheadBuffer({ count, getLabel: (i) => typeahead(i) })
		: null;

	const items = (): HTMLElement[] =>
		Array.from(container.querySelectorAll<HTMLElement>(itemSelector));

	const itemAt = (index: number): HTMLElement | null =>
		container.querySelector<HTMLElement>(`[data-composite-index="${index}"]`);

	function stampContainer(): void {
		container.setAttribute("role", containerRole);
		if (!container.hasAttribute("tabindex")) container.tabIndex = 0;
		if (orientation === Orientation.Horizontal) {
			container.setAttribute("aria-orientation", "horizontal");
		} else if (orientation === Orientation.Vertical) {
			container.setAttribute("aria-orientation", "vertical");
		}
		if (useAriaActiveDescendant) {
			const i = activeIndex();
			if (i >= 0 && i < count()) kbTarget.setAttribute("aria-activedescendant", `${prefix}-${i}`);
			else kbTarget.removeAttribute("aria-activedescendant");
		}
	}

	function stampItems(): void {
		const cursor = activeIndex();
		for (const el of items()) {
			const index = Number(el.dataset.compositeIndex);
			el.id = `${prefix}-${index}`;
			if (resolvedItemRole !== undefined) el.setAttribute("role", resolvedItemRole);
			el.tabIndex = useAriaActiveDescendant ? -1 : index === cursor ? 0 : -1;
			if (selectionAttribute === SelectionAttribute.AriaSelected) {
				el.setAttribute("aria-selected", String(index === cursor));
			} else if (selectionAttribute === SelectionAttribute.AriaChecked) {
				el.setAttribute("aria-checked", String(index === cursor));
			}
		}
	}

	function refresh(): void {
		stampContainer();
		stampItems();
	}

	function state(): CompositeState {
		return compositeInit({
			orientation,
			count: count(),
			activeIndex: activeIndex(),
			...(columns?.() !== undefined ? { columns: columns() } : {}),
			wrap,
			...(pageSize !== undefined ? { pageSize } : {}),
		});
	}

	function dispatch(key: CompositeKey, ctx?: { typeaheadIndex?: number }): void {
		const prev = state();
		const next = compositeKey(prev, key, {
			...(disabled?.() !== undefined ? { disabled: disabled() } : {}),
			...(ctx?.typeaheadIndex !== undefined ? { typeaheadIndex: ctx.typeaheadIndex } : {}),
			...(cells?.() !== undefined ? { cells: cells() } : {}),
		});
		if (next.activeIndex === prev.activeIndex) return;
		onActiveIndexChange(next.activeIndex);
		refresh();
		if (!useAriaActiveDescendant) itemAt(next.activeIndex)?.focus();
	}

	function onKeyDown(e: KeyboardEvent): void {
		const target = e.target as Element | null;
		if (
			target !== container &&
			target !== kbTarget &&
			(target === null || target.closest("[data-composite-index]") === null)
		) {
			return;
		}
		if (e.key === "Enter" || (e.key === " " && host !== CompositeHost.Combobox)) {
			e.preventDefault();
			if (e.repeat) return;
			const i = activeIndex();
			if (i >= 0) onActivate?.(i);
			return;
		}
		if (
			onDelete !== undefined &&
			host !== CompositeHost.Combobox &&
			(e.key === "Delete" || e.key === "Backspace")
		) {
			const i = activeIndex();
			if (i < 0) return;
			e.preventDefault();
			if (e.repeat) return;
			onDelete(i);
			return;
		}
		const mapped = pickKeymap(orientation, host)[e.key];
		if (mapped !== undefined) {
			e.preventDefault();
			dispatch(mapped);
			return;
		}
		if (buffer !== null && isPrintableChar(e)) {
			const result = buffer.append(e.key, activeIndex());
			if (result.index !== null && result.index >= 0) {
				e.preventDefault();
				dispatch(CompositeKey.Typeahead, { typeaheadIndex: result.index });
			}
		}
	}

	kbTarget.addEventListener("keydown", onKeyDown);
	refresh();

	return {
		refresh,
		destroy() {
			kbTarget.removeEventListener("keydown", onKeyDown);
		},
	};
}
