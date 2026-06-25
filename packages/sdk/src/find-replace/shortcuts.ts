/**
 * Canonical find/replace action ids + default chords (doc 59 §Keyboard).
 * One source of truth — `renderer/shortcuts/default-chords.ts`, the main
 * `shortcut-registry.ts`, and every text app's `useShortcut` all
 * reference these (the `NAV_*_CHORD` precedent), so the chord is
 * identical in every text-capable app and never re-typed as a literal.
 * Binding lives with `<FindBar>` (B9.1b) — this is the contract.
 */

import { attachShortcut } from "../shortcut/attach-shortcut";

export enum FindAction {
	Open = "editor/find",
	OpenReplace = "editor/find.replace",
	Next = "editor/find.next",
	Previous = "editor/find.previous",
	Close = "editor/find.close",
}

/** Default chords. Lists carry every accelerator doc 59's table names;
 *  `CmdOrCtrl` is the shared parser's platform token. */
export const FIND_DEFAULT_CHORDS: Record<FindAction, readonly string[]> = Object.freeze({
	[FindAction.Open]: ["CmdOrCtrl+f"],
	[FindAction.OpenReplace]: ["CmdOrCtrl+Alt+f", "Ctrl+h"],
	[FindAction.Next]: ["Enter", "CmdOrCtrl+g"],
	[FindAction.Previous]: ["Shift+Enter", "CmdOrCtrl+Shift+g"],
	[FindAction.Close]: ["Escape"],
}) as Record<FindAction, readonly string[]>;

export const FIND_ACTIONS: readonly FindAction[] = Object.freeze([
	FindAction.Open,
	FindAction.OpenReplace,
	FindAction.Next,
	FindAction.Previous,
	FindAction.Close,
]) as readonly FindAction[];

/** The chords safe to bind on a *global* target. Bare `Enter` /
 *  `Shift+Enter` are deliberately excluded — they are next/previous only
 *  while the find term input is focused (the FindBar handles those on the
 *  input), never a global hijack of Enter. `Escape` closes only while the
 *  bar is open (the controller no-ops a close when already closed). */
const GLOBAL_FIND_CHORDS: Record<FindAction, readonly string[]> = Object.freeze({
	[FindAction.Open]: FIND_DEFAULT_CHORDS[FindAction.Open],
	[FindAction.OpenReplace]: FIND_DEFAULT_CHORDS[FindAction.OpenReplace],
	[FindAction.Next]: ["CmdOrCtrl+g"],
	[FindAction.Previous]: ["CmdOrCtrl+Shift+g"],
	[FindAction.Close]: FIND_DEFAULT_CHORDS[FindAction.Close],
}) as Record<FindAction, readonly string[]>;

/** What `attachFindShortcuts` drives — the controller surface it needs,
 *  so the binder is testable with a stub and has no React/DOM coupling
 *  beyond the keydown target. `isOpen` is optional so existing tests can
 *  pass a 4-method stub; in production the full controller satisfies it
 *  via `getState().open`. */
export interface FindShortcutTarget {
	open(mode?: "find" | "find-replace"): void;
	next(): void;
	previous(): void;
	close(): void;
	/** Lets the Escape binding decline to swallow when the bar is already
	 *  closed, so sibling modal/popover handlers on the same window keep
	 *  receiving Escape. Production callers should always provide this. */
	isOpen?(): boolean;
}

/**
 * Bind the global find chords on a vanilla target (the
 * `attachNavShortcuts` precedent — one binder, React + DOM twins share
 * it, no parallel keydown handler to drift). Returns one disposer.
 */
export function attachFindShortcuts(
	target: Window | HTMLElement,
	controller: FindShortcutTarget,
): () => void {
	const run: Record<FindAction, () => void> = {
		[FindAction.Open]: () => controller.open("find"),
		[FindAction.OpenReplace]: () => controller.open("find-replace"),
		[FindAction.Next]: () => controller.next(),
		[FindAction.Previous]: () => controller.previous(),
		[FindAction.Close]: () => controller.close(),
	};
	const disposers: Array<() => void> = [];
	for (const action of FIND_ACTIONS) {
		for (const chord of GLOBAL_FIND_CHORDS[action]) {
			// The Close chord (Escape) MUST fire even while suppression is
			// active — the controller itself registers a suppression source on
			// open(), so without this opt-out Escape can never close the bar
			// once it opens. Editable-target rule also gets bypassed because the
			// user pressing Escape while focus is inside the bar input expects
			// the bar to close. AND `preventDefault: false` lets the handler
			// decline to swallow when the bar is closed — otherwise the listener
			// would eat every Escape on the window even when find isn't open,
			// breaking sibling modal/popover Escape handlers.
			const isCloseAction = action === FindAction.Close;
			const handler = isCloseAction
				? (event: KeyboardEvent) => {
						if (controller.isOpen && !controller.isOpen()) return;
						event.preventDefault();
						event.stopPropagation();
						controller.close();
					}
				: run[action];
			disposers.push(
				attachShortcut(target, chord, handler, {
					allowWhileSuppressed: isCloseAction,
					...(isCloseAction && { preventDefault: false }),
				}),
			);
		}
	}
	return () => {
		for (const d of disposers) d();
	};
}
