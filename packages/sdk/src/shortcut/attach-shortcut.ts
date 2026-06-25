/**
 * `attachShortcut` — the pure-DOM shortcut binder for plain-DOM apps, the
 * imperative twin of the React `useShortcut`. Same delivery rule as the
 * shell hook: skip already-handled events, match the chord, then
 * `preventDefault()` + `stopPropagation()` and invoke the handler.
 *
 * Cross-layer single-key suppression — same rule the shell renderer
 * applies (6.10e), now shared with apps via the SDK: bare-letter / bare-
 * key chords (`T`, `?`, `/`, `Escape`) skip when focus is in an editable
 * field OR any registered suppression source says a menu owns the
 * keyboard ([[suppression]]). Modifier chords (`CmdOrCtrl+F`,
 * `CmdOrCtrl+S`) always pass through — they're intentional gestures. The
 * suppression-source seam mirrors fancy-menus' `isOpen` shape so the 8.8
 * swap is a wiring change, not an API change.
 *
 * `target` may be a `Window` or an `HTMLElement` (scope the binding to a
 * focusable region). Returns a disposer; call it to remove the listener.
 */

import { chordIsSingleKey, matchesChord } from "./chord";
import { isEditableElement } from "./is-editable";
import { isAnyShortcutSuppressed } from "./suppression";

export type ShortcutOptions = {
	/** Set to false to no-op without detaching (callers that want a stable
	 *  disposer across an enable/disable toggle still re-attach; this is the
	 *  cheap inline guard for transient disables). */
	enabled?: boolean;
	/** Opt out of the single-key suppression rule (rare — only when the
	 *  caller intentionally wants the chord to fire even while typing or a
	 *  menu is open, e.g. `Escape` bindings that dismiss the host overlay). */
	allowWhileSuppressed?: boolean;
	/** Set to false to skip `preventDefault()` + `stopPropagation()` before
	 *  invoking the handler — the handler decides whether to swallow based
	 *  on its own state. Used by Find's `Escape` binding so the listener
	 *  doesn't eat Escape events meant for sibling modal/popover handlers
	 *  on the same window when the find bar itself is closed. */
	preventDefault?: boolean;
};

export type ShortcutDisposer = () => void;

export function attachShortcut(
	target: Window | HTMLElement,
	chord: string,
	handler: (event: KeyboardEvent) => void,
	options: ShortcutOptions = {},
): ShortcutDisposer {
	const listener = ((event: KeyboardEvent) => {
		if (options.enabled === false) return;
		if (event.defaultPrevented) return;
		if (!matchesChord(event, chord)) return;
		if (!options.allowWhileSuppressed && chordIsSingleKey(chord)) {
			if (isEditableElement(event.target) || isAnyShortcutSuppressed()) return;
		}
		if (options.preventDefault !== false) {
			event.preventDefault();
			event.stopPropagation();
		}
		handler(event);
	}) as EventListener;

	target.addEventListener("keydown", listener);
	return () => target.removeEventListener("keydown", listener);
}
