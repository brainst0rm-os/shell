/**
 * Shared DOM-key → `CompositeKey` tables + helpers, used by BOTH the React
 * `useCompositeKeyboard` hook and the framework-agnostic
 * `attachCompositeKeyboard` DOM binding. Keeping the mapping here (rather than
 * private to either) is the DRY seam: a key-table change lands once and both
 * surfaces inherit it, and raw `e.key` strings never leak past this module.
 */

import { CompositeHost } from "./composite-host";
import { CompositeKey } from "./composite-keyboard";
import { Orientation } from "./orientation";

const VERTICAL_KEYMAP = Object.freeze<Record<string, CompositeKey>>({
	ArrowDown: CompositeKey.Next,
	ArrowUp: CompositeKey.Previous,
	Home: CompositeKey.Home,
	End: CompositeKey.End,
	PageDown: CompositeKey.PageDown,
	PageUp: CompositeKey.PageUp,
});

const HORIZONTAL_KEYMAP = Object.freeze<Record<string, CompositeKey>>({
	ArrowRight: CompositeKey.Next,
	ArrowLeft: CompositeKey.Previous,
	Home: CompositeKey.Home,
	End: CompositeKey.End,
	PageDown: CompositeKey.PageDown,
	PageUp: CompositeKey.PageUp,
});

const GRID_KEYMAP = Object.freeze<Record<string, CompositeKey>>({
	ArrowRight: CompositeKey.Next,
	ArrowLeft: CompositeKey.Previous,
	ArrowDown: CompositeKey.NextRow,
	ArrowUp: CompositeKey.PreviousRow,
	Home: CompositeKey.Home,
	End: CompositeKey.End,
	PageDown: CompositeKey.PageDown,
	PageUp: CompositeKey.PageUp,
});

// Combobox host: only the orientation arrows reach the list. Home/End/Page are
// intentionally absent so they move the input's text cursor instead.
const VERTICAL_COMBOBOX_KEYMAP = Object.freeze<Record<string, CompositeKey>>({
	ArrowDown: CompositeKey.Next,
	ArrowUp: CompositeKey.Previous,
});

const HORIZONTAL_COMBOBOX_KEYMAP = Object.freeze<Record<string, CompositeKey>>({
	ArrowRight: CompositeKey.Next,
	ArrowLeft: CompositeKey.Previous,
});

// Spatial: all four arrows are directional (resolved via `spatialGridStep`);
// Home/End jump to first/last in index order. No Page (a sparse grid has no
// meaningful page span).
const SPATIAL_KEYMAP = Object.freeze<Record<string, CompositeKey>>({
	ArrowRight: CompositeKey.Next,
	ArrowLeft: CompositeKey.Previous,
	ArrowDown: CompositeKey.NextRow,
	ArrowUp: CompositeKey.PreviousRow,
	Home: CompositeKey.Home,
	End: CompositeKey.End,
});

export function pickKeymap(
	orientation: Orientation,
	host: CompositeHost,
): Readonly<Record<string, CompositeKey>> {
	if (host === CompositeHost.Combobox) {
		return orientation === Orientation.Horizontal
			? HORIZONTAL_COMBOBOX_KEYMAP
			: VERTICAL_COMBOBOX_KEYMAP;
	}
	if (orientation === Orientation.Spatial) return SPATIAL_KEYMAP;
	if (orientation === Orientation.Grid) return GRID_KEYMAP;
	if (orientation === Orientation.Horizontal) return HORIZONTAL_KEYMAP;
	return VERTICAL_KEYMAP;
}

/** The keyboard-event fields the printable-char test needs — satisfied by both
 *  React's `KeyboardEvent` and the DOM `KeyboardEvent`. */
export type PrintableKeyEvent = {
	key: string;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
	keyCode: number;
	isComposing: boolean;
};

/** Single-character key without Ctrl/Meta/Alt — typeahead input. Shift may be
 *  held (capitals still type-ahead). Skips IME composition: CJK input fires
 *  keydown with a single-char `key` while composing, and consuming those would
 *  steal the composition target from the IME. */
export function isPrintableChar(e: PrintableKeyEvent): boolean {
	if (e.ctrlKey || e.metaKey || e.altKey) return false;
	if (e.isComposing || e.keyCode === 229) return false;
	return e.key.length === 1 && e.key !== " ";
}
