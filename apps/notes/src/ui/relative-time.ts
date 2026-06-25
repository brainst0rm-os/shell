/**
 * Relative-time formatter for the sidebar / footer. Intentionally tiny:
 *
 *   < 60 s  → "just now"
 *   < 60 m  → "5m"
 *   < 24 h  → "3h"
 *   < 7 d   → "2d"
 *   < 1 y   → "May 12"
 *   ≥ 1 y   → "May 12, 2025"
 *
 * The shell's full localized `Intl.RelativeTimeFormat` wiring lands with
 * the Stage-12 locale layer; this util keeps strings stable until then.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

export function relativeTime(timestamp: number, now: number = Date.now()): string {
	const delta = Math.max(0, now - timestamp);
	if (delta < MINUTE_MS) return "just now";
	if (delta < HOUR_MS) return `${Math.floor(delta / MINUTE_MS)}m`;
	if (delta < DAY_MS) return `${Math.floor(delta / HOUR_MS)}h`;
	if (delta < WEEK_MS) return `${Math.floor(delta / DAY_MS)}d`;
	const date = new Date(timestamp);
	const sameYear = date.getFullYear() === new Date(now).getFullYear();
	return date.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		year: sameYear ? undefined : "numeric",
	});
}
