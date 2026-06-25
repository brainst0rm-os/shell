/**
 * Shortcut suppression registry — the rule: a focused text input OR
 * an open menu hijacks the keyboard, so global single-key chords (no
 * `Cmd/Ctrl/Alt` modifier) must NOT fire. Modifier chords (`CmdOrCtrl+F`,
 * `CmdOrCtrl+S`) always pass through.
 *
 * Shape mirrors fancy-menus' `MenuStore.isOpen(id?)` /
 * `useIsAnyMenuOpen()` so the swap at plan row 8.8 (`@react-fancy-menus/core` as
 * the swap-in dep, per [[feedback_avoid_blocking_on_deps]]) is a wiring
 * change, not an API change. Today: find-bar registers itself, so opening
 * find silences `t/d/w/m`-style app chords. Tomorrow: `MenuProvider`
 * registers `() => store.isOpen()` once and every menu inherits the same
 * suppression for free.
 *
 * No React, no DOM — module-level `Set<() => boolean>` so the find
 * controller (pure) can register from anywhere and the editable check
 * (DOM-only) stays decoupled.
 */

export type ShortcutSuppressionSource = () => boolean;

const sources = new Set<ShortcutSuppressionSource>();

/** Register a predicate that returns true while keyboard should be hijacked
 *  by a UI (an open menu, an active overlay). Returns a disposer that
 *  removes the predicate from the registry. */
export function registerShortcutSuppression(source: ShortcutSuppressionSource): () => void {
	sources.add(source);
	return () => {
		sources.delete(source);
	};
}

/** True when at least one registered source says "I own the keyboard right
 *  now." Consulted by `attachShortcut` on every single-key chord. */
export function isAnyShortcutSuppressed(): boolean {
	for (const s of sources) {
		try {
			if (s()) return true;
		} catch {
			// A throwing source must never block delivery — drop it silently.
		}
	}
	return false;
}

/** Test-only — clear the registry between specs so a leaked source from
 *  one test doesn't suppress chords in the next. NOT exported from the
 *  public barrel. */
export function _resetShortcutSuppressionForTests(): void {
	sources.clear();
}
