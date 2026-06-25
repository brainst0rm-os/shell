/**
 * Pure multi-select primitives shared by every list/grid surface (Database
 * view rows, Files content pane). The *state shape* stays per-app — the
 * Database keeps a mutable `Set` + anchor, Files a frozen reducer state —
 * but the range/toggle/modifier algorithm is identical and lives here.
 *
 * Extracted at copy two: both apps had re-derived anchor→target range
 * slicing and the shift/mod → modifier mapping. Sharing the math keeps
 * "what shift-click selects" identical across apps; each app wraps it in
 * its preferred state container.
 */

/** How a click combines with the existing selection. */
export enum SelectionModifier {
	/** Plain click — replace the selection with the single target. */
	None = "none",
	/** Shift-click — select the inclusive range anchor→target over the
	 *  current visible order. */
	Range = "range",
	/** Mod-click (Cmd on macOS / Ctrl elsewhere) — toggle the target,
	 *  leaving the rest of the selection intact. */
	Toggle = "toggle",
}

/**
 * The inclusive id range between `from` and `to` over the current visible
 * order. Direction-agnostic (anchor may sit before or after the target).
 * Falls back to `[to]` when either id isn't in `order` (a stale anchor or
 * an off-list target) — the caller decides what the anchor becomes.
 */
export function computeRange(from: string, to: string, order: ReadonlyArray<string>): string[] {
	const i = order.indexOf(from);
	const j = order.indexOf(to);
	if (i === -1 || j === -1) return [to];
	const lo = Math.min(i, j);
	const hi = Math.max(i, j);
	return order.slice(lo, hi + 1);
}

/** Toggle `id` in `selected`, returning a new `Set` (never mutates the
 *  input). */
export function toggleId(selected: ReadonlySet<string>, id: string): Set<string> {
	const next = new Set(selected);
	if (next.has(id)) next.delete(id);
	else next.add(id);
	return next;
}

/** Derive the modifier from an event's shift / mod state. The caller
 *  passes the platform-correct `mod` (macOS → metaKey, others → ctrlKey)
 *  since the shortcut layer is the single source of truth for that. */
export function modifierFromEvent(opts: { shift: boolean; mod: boolean }): SelectionModifier {
	if (opts.shift) return SelectionModifier.Range;
	if (opts.mod) return SelectionModifier.Toggle;
	return SelectionModifier.None;
}
