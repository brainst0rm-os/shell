/**
 * `useShortcutLabel(id)` — resolves a shortcut-registry id to its display
 * shape: the canonical chord string (load-bearing for `aria-keyshortcuts`)
 * plus the platform-aware glyph tokens a UI surface renders as `<kbd>`s.
 *
 * Pairs with `useShortcut(id, handler)` — the same id flows through both
 * hooks so a single registry entry drives delivery AND display, no
 * hand-written chord strings on buttons (per CLAUDE.md "Keyboard via the
 * shortcut registry, never raw `e.key`").
 *
 * v1 data source: the renderer-side `defaultChordFor` seed (same as
 * Settings → Keyboard and the cheatsheet). Once the main-process
 * registry's per-renderer push lands, the resolver swaps for the live
 * source without touching consumers.
 */

import { useMemo } from "react";
import { formatChord, isMacPlatform } from "./chord-display";
import { defaultChordFor } from "./default-chords";

export interface ShortcutLabel {
	/** Canonical chord string (e.g. `"CmdOrCtrl+Shift+K"`). Used as the
	 *  `aria-keyshortcuts` value — assistive tech reads this verbatim. */
	readonly chord: string;
	/** Display tokens for `<kbd>` rendering. macOS gets `["⌘","⇧","K"]`,
	 *  other platforms get `["Ctrl","Shift","K"]`. */
	readonly tokens: ReadonlyArray<string>;
}

/** Look up the display shape for a registry id. Returns `null` when the
 *  id is unknown or the action is unbound — consumers render nothing
 *  rather than showing an empty hint. */
export function useShortcutLabel(id: string): ShortcutLabel | null {
	return useMemo(() => {
		const chord = defaultChordFor(id);
		if (chord === null || chord === "") return null;
		const tokens = formatChord(chord, isMacPlatform());
		if (tokens.length === 0) return null;
		return { chord, tokens };
	}, [id]);
}
