/**
 * Renderer-side OS prefers-color-scheme watcher.
 *
 * Main process is the authority on the resolved theme (it watches
 * `nativeTheme.updated` and re-pushes the snapshot), but the renderer
 * needs the synchronous current reading in two places:
 *
 *   1. The `appearance.toggle` shortcut handler — to compute "opposite of
 *      the currently-resolved slot" without a round-trip through main.
 *   2. (Future) any UI affordance that wants to show what Auto resolves to
 *      right now (e.g. the Settings → Appearance card highlight).
 *
 * Use `systemPrefersDark()` for one-shot reads; subscribe to
 * `onSystemPreferenceChange` if you need to react.
 *
 * SSR / non-browser contexts (tests under Bun): `matchMedia` is absent;
 * fall back to `false` (light) so the helper is safe to import.
 */

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function systemPrefersDark(): boolean {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
	return window.matchMedia(DARK_QUERY).matches;
}

export function onSystemPreferenceChange(listener: (prefersDark: boolean) => void): () => void {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
		return () => undefined;
	}
	const mql = window.matchMedia(DARK_QUERY);
	const handler = (event: MediaQueryListEvent) => listener(event.matches);
	mql.addEventListener("change", handler);
	return () => mql.removeEventListener("change", handler);
}
