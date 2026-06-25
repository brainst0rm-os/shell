/**
 * Pure cheatsheet aggregator per §Aggregation
 * across the sandbox boundary.
 *
 * The cheatsheet body (Stage 6.9, gated on design-system 8.8) renders the
 * UI; this module owns the data plumbing — turning a `ShortcutRegistry`
 * snapshot into the list of bindings the cheatsheet should actually show
 * right now, given which app is focused and what scope it has reported.
 *
 * Rules (per the doc):
 *   - Every `shell/*` binding is included, always.
 *   - When an app is focused, that app's bindings (`app/<focusedAppId>/*`)
 *     are included, filtered by active scope (see below).
 *   - Other apps contribute nothing.
 *   - Scope filter (only applied when the app reported a scope via
 *     `setActiveScope`):
 *       * a binding with `scope === undefined` is always included
 *         (defaults to window-wide)
 *       * a binding with `scope === "window"` is always included
 *       * a binding with `scope === activeScope` is included
 *       * otherwise excluded
 *     When the app reported `null` (no scope set), no narrow filter is
 *     applied — every app binding is included.
 *
 * Cleared bindings (chord === null) are still part of the cheatsheet — per
 *  §Settings panel, the user can rebind them; only the chord is
 * absent, the action is reachable.
 *
 * 6.10c.
 */

import type { ResolvedBinding, ShortcutRegistry } from "./shortcut-registry";

export type CheatsheetOptions = {
	/** App id of the currently-focused window, or `null` when only the
	 *  shell (dashboard) is focused. */
	focusedAppId: string | null;
};

const WINDOW_SCOPE = "window" as const;

export function aggregateCheatsheet(
	registry: ShortcutRegistry,
	options: CheatsheetOptions,
): ResolvedBinding[] {
	const { focusedAppId } = options;
	const activeScope = focusedAppId === null ? null : registry.getActiveScope(focusedAppId);
	const out: ResolvedBinding[] = [];
	for (const binding of registry.listAll()) {
		if (binding.action.layer === "shell") {
			out.push(binding);
			continue;
		}
		// App layer: include only the focused app, scope-filtered.
		if (focusedAppId === null) continue;
		if (binding.action.appId !== focusedAppId) continue;
		if (!matchesScope(binding.action.scope, activeScope)) continue;
		out.push(binding);
	}
	return out;
}

function matchesScope(bindingScope: string | undefined, activeScope: string | null): boolean {
	if (activeScope === null) return true; // no narrow filter requested
	if (bindingScope === undefined) return true; // window-default
	if (bindingScope === WINDOW_SCOPE) return true;
	return bindingScope === activeScope;
}
