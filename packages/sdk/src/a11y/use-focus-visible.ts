/**
 * `useFocusVisible` — JS twin of the CSS `:focus-visible` selector. Tracks
 * the most recent input modality at the document level: keyboard-driven →
 * `true`, pointer-driven → `false`. Surfaces that need to react in JS
 * (virtualized lists scrolling into view on keyboard focus but not on click)
 * subscribe to this signal.
 *
 * Per `61-keyboard-accessibility.md §Focus management invariants` point 6:
 * Tab / F6 / Arrow / programmatic-focus-from-keyboard ⇒ visible; mouse and
 * touch ⇒ suppressed. The modality flips on the next keydown / pointerdown,
 * not on the focus event itself, so the call order between event delivery
 * and `:focus-visible` evaluation in the browser doesn't matter.
 */

import { useEffect, useState } from "react";

type Modality = "keyboard" | "pointer";

const KEYBOARD_KEYS = new Set([
	"Tab",
	"ArrowUp",
	"ArrowDown",
	"ArrowLeft",
	"ArrowRight",
	"Home",
	"End",
	"PageUp",
	"PageDown",
	"Enter",
	"Escape",
	" ",
	"F6",
]);

let modality: Modality = "pointer";
const listeners = new Set<(m: Modality) => void>();
let installed = false;

function notify(next: Modality): void {
	if (next === modality) return;
	modality = next;
	for (const cb of listeners) cb(modality);
}

function onKeydown(e: KeyboardEvent): void {
	// Modifier-only presses (Shift held to enable shift-tab is fine — the key
	// is still "Tab"). Repeat keys still count as keyboard activity.
	if (KEYBOARD_KEYS.has(e.key)) {
		notify("keyboard");
		return;
	}
	// Any printable single-character press counts as keyboard activity too;
	// the user is typing. Don't include modifier-only events (Shift / Control
	// pressed alone don't move focus).
	if (e.key.length === 1) notify("keyboard");
}

function onPointerdown(): void {
	notify("pointer");
}

function install(): void {
	if (installed) return;
	if (typeof document === "undefined") return;
	document.addEventListener("keydown", onKeydown, true);
	document.addEventListener("pointerdown", onPointerdown, true);
	document.addEventListener("mousedown", onPointerdown, true);
	document.addEventListener("touchstart", onPointerdown, true);
	installed = true;
}

function uninstall(): void {
	if (!installed) return;
	document.removeEventListener("keydown", onKeydown, true);
	document.removeEventListener("pointerdown", onPointerdown, true);
	document.removeEventListener("mousedown", onPointerdown, true);
	document.removeEventListener("touchstart", onPointerdown, true);
	installed = false;
}

export type UseFocusVisibleResult = {
	readonly isFocusVisible: boolean;
};

export function useFocusVisible(): UseFocusVisibleResult {
	const [snapshot, setSnapshot] = useState<Modality>(modality);
	useEffect(() => {
		install();
		const cb = (m: Modality) => setSnapshot(m);
		listeners.add(cb);
		// Re-sync in case the module-scope modality changed before subscribe.
		setSnapshot(modality);
		return () => {
			listeners.delete(cb);
			if (listeners.size === 0) uninstall();
		};
	}, []);
	return { isFocusVisible: snapshot === "keyboard" };
}

/** Test-only — clear the module-scope modality + drop listeners + tear down
 *  the document-level binders. */
export function _resetFocusVisibleForTests(): void {
	modality = "pointer";
	listeners.clear();
	uninstall();
}
