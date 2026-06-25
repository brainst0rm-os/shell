/**
 * Window reveal that honors the no-focus harness flag.
 *
 * Under the soak / perf / visual harnesses (`BRAINSTORM_NO_FOCUS=1`, also
 * auto-set by `BRAINSTORM_SOAK_DEBUG=1`) we reveal windows with
 * `showInactive` so repeated Playwright launches don't rip the developer's
 * OS focus away every few seconds — Playwright drives the renderer over CDP,
 * which never needs OS-level activation. Production keeps `show()`, which
 * raises + focuses the window; that's the right behavior for a real app boot
 * or window open. The two paths are byte-identical at the rendered-frame
 * level; only OS-level activation differs.
 */

/** The reveal-relevant slice of a window — satisfied by both Electron
 *  `BrowserWindow` and `BaseWindow`, and by the container's duck-typed handle. */
export interface RevealableWindow {
	isDestroyed(): boolean;
	show(): void;
	showInactive(): void;
}

export function focusStealingDisabled(): boolean {
	return process.env.BRAINSTORM_NO_FOCUS === "1" || process.env.BRAINSTORM_SOAK_DEBUG === "1";
}

export function revealWindow(window: RevealableWindow): void {
	if (window.isDestroyed()) return;
	if (focusStealingDisabled()) window.showInactive();
	else window.show();
}
