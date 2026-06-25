/**
 * Keyboard-navigation mode flag (2026-06-21).
 *
 * Focus rings must appear ONLY after a deliberate **plain Tab** — never on a
 * mouse click, never on a modifier combo (Cmd/Ctrl/Alt + Tab is a window/app
 * switch, not in-page navigation), and never lingering after the user
 * Cmd+Tabs back to the window. Browser `:focus-visible` alone doesn't give us
 * that last part: Chromium re-evaluates `:focus-visible` as true when the
 * window regains focus, which made a stale ring reappear on the dashboard.
 *
 * So the global focus CSS gates the baseline ring on `html[data-kbnav="on"]`,
 * and this module is the single switch:
 *   - bare Tab (Shift allowed — back-tab is still keyboard nav) → on
 *   - any pointer-down → off (the user reached for the mouse)
 *   - window blur → off (a Cmd+Tab return shows no ring until the next Tab)
 *
 * Edit surfaces (`input` / `textarea` / `select` / contenteditable) are already
 * excluded by the baseline selector itself, so typing never lights a ring.
 */

function armKeyboardNav(): void {
	document.documentElement.dataset.kbnav = "on";
}

function disarmKeyboardNav(): void {
	document.documentElement.removeAttribute("data-kbnav");
}

/** Wire the keyboard-nav listeners. Call once at renderer boot, before render. */
export function installFocusNav(): void {
	if (typeof window === "undefined") return;
	window.addEventListener(
		"keydown",
		(event) => {
			if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
				armKeyboardNav();
			}
		},
		true,
	);
	window.addEventListener("pointerdown", disarmKeyboardNav, true);
	window.addEventListener("blur", disarmKeyboardNav);
}
