/**
 * Pure formatters for the Settings → Search panel. Split out so the
 * numeric / time / coverage logic is unit-tested without mounting React
 * (the section component is a thin shell over these).
 *
 * Byte / relative-time formatting lives in the shared `format/relative-time`
 * module; this file re-exports `formatBytes` and wraps `formatRelative` with
 * the panel's null-on-absent contract.
 */

import { formatBytes, formatRelative } from "../format/relative-time";

export { formatBytes };

/**
 * Coverage = indexed rows ÷ indexable entities the sources hold, clamped
 * to 0–100. `null` available (no vault session / scan failed) → `null`
 * (the panel renders "—", never a misleading 0%). A source count of 0
 * with 0 indexed is *full* coverage (an empty vault is fully indexed),
 * not a divide-by-zero.
 */
export function coveragePercent(total: number, available: number | null): number | null {
	if (available === null) return null;
	// No indexable entities → fully covered (an empty vault, or a stale
	// index whose extra rows the sources have since dropped — clamped, not
	// a divide-by-zero).
	if (available <= 0) return 100;
	const pct = (total / available) * 100;
	if (!Number.isFinite(pct)) return null;
	return Math.max(0, Math.min(100, Math.round(pct)));
}

/** Coarse relative time, returning `null` for an absent/zero/future
 *  timestamp so the index-health panel can render "never" instead. The
 *  formatting itself is the shared, `t()`-backed `formatRelative`; this
 *  wrapper only owns the index panel's null-sentinel contract. */
export function formatRelativeTime(ts: number, now: number = Date.now()): string | null {
	if (!Number.isFinite(ts) || ts <= 0 || now - ts < 0) return null;
	return formatRelative(now, ts);
}

/**
 * `io.brainstorm.notes/Note/v1` → `Note`. App-declared type URIs are
 * `<app-id>/<Type>/<version>`; surface just the `<Type>` segment, which
 * is what a user recognises. Falls back to the raw string when the shape
 * doesn't match (never throws, never blanks a row).
 */
export function shortTypeName(type: string): string {
	if (typeof type !== "string" || type.length === 0) return type;
	const segments = type.split("/").filter((s) => s.length > 0);
	if (segments.length >= 2) {
		const candidate = segments[segments.length - 2];
		if (candidate && candidate.length > 0) return candidate;
	}
	return type;
}
