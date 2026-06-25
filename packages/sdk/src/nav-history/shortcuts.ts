/**
 * The canonical in-app back/forward chords, shared so every app binds the
 * SAME keys (CLAUDE.md "Keyboard via the shortcut registry, never raw
 * e.key" + DRY). `CmdOrCtrl+[` / `CmdOrCtrl+]` mirror the browser and the
 * pre-existing Files binding; `Alt+Arrow` is the second muscle-memory.
 * Mouse back/forward (buttons 3/4) is bound by `attachNavMouse`.
 *
 * The shell's main-process shortcut registry mirrors these under the
 * `app/nav.back` / `app/nav.forward` ids; keep both in lock-step.
 */

import { attachShortcut } from "../shortcut/attach-shortcut";

export const NAV_BACK_CHORD = "CmdOrCtrl+[";
export const NAV_BACK_CHORD_ALT = "Alt+ArrowLeft";
export const NAV_FORWARD_CHORD = "CmdOrCtrl+]";
export const NAV_FORWARD_CHORD_ALT = "Alt+ArrowRight";

export type NavShortcutTarget = Window | HTMLElement;

/** Bind the four nav chords + the mouse back/forward buttons on a vanilla
 *  target. Returns one disposer that unbinds everything. */
export function attachNavShortcuts(
	target: NavShortcutTarget,
	onBack: () => void,
	onForward: () => void,
): () => void {
	const disposers = [
		attachShortcut(target, NAV_BACK_CHORD, onBack),
		attachShortcut(target, NAV_BACK_CHORD_ALT, onBack),
		attachShortcut(target, NAV_FORWARD_CHORD, onForward),
		attachShortcut(target, NAV_FORWARD_CHORD_ALT, onForward),
	];
	const onMouse = (e: MouseEvent): void => {
		// 3 = browser-back thumb button, 4 = browser-forward.
		if (e.button === 3) {
			e.preventDefault();
			onBack();
		} else if (e.button === 4) {
			e.preventDefault();
			onForward();
		}
	};
	target.addEventListener("mouseup", onMouse as EventListener);
	disposers.push(() => target.removeEventListener("mouseup", onMouse as EventListener));
	return () => {
		for (const d of disposers) d();
	};
}
