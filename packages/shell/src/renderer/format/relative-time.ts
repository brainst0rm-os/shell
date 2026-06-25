/**
 * Shared renderer formatters for byte sizes and coarse relative time.
 *
 * These two helpers were re-implemented across the Settings / dashboard
 * surfaces (search index health, network egress, open-files, sync status)
 * with divergent rounding and — worse — two of the copies hardcoded English
 * ("just now", `${n}m ago`) instead of routing through `t()`. This module is
 * the single source of truth: every user-visible string goes through the
 * neutral `shell.format.*` catalog keys.
 *
 * Both are coarse on purpose (no second precision past "Ns ago") — the
 * surfaces consuming them are health/audit panels, not live clocks.
 */

import { t } from "../i18n/t";

const KIB = 1024;
const BYTE_UNIT_KEYS = [
	"shell.format.bytes.b",
	"shell.format.bytes.kb",
	"shell.format.bytes.mb",
	"shell.format.bytes.gb",
	"shell.format.bytes.tb",
] as const;

/**
 * Human byte size — binary (1024) units, ≤1 decimal, no trailing `.0`.
 * Zero / negative / non-finite collapse to "0 B" rather than "NaN".
 */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return t("shell.format.bytes.b", { value: 0 });
	let value = bytes;
	let unit = 0;
	while (value >= KIB && unit < BYTE_UNIT_KEYS.length - 1) {
		value /= KIB;
		unit += 1;
	}
	const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
	const key = BYTE_UNIT_KEYS[unit] ?? "shell.format.bytes.b";
	return t(key, { value: rounded });
}

/**
 * Coarse relative time for a known past timestamp: "just now" / "Ns ago" /
 * "Nm ago" / "Nh ago" / "Nd ago". The caller owns the absent / future /
 * "never" case (each surface renders its own sentinel — `null`, "—",
 * "Never") and passes only a valid `then <= now`; this clamps a small
 * future skew to 0 rather than producing a negative count.
 */
export function formatRelative(now: number, then: number): string {
	const seconds = Math.max(0, Math.floor((now - then) / 1000));
	if (seconds < 10) return t("shell.format.justNow");
	if (seconds < 60) return t("shell.format.secondsAgo", { count: seconds });
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return t("shell.format.minutesAgo", { count: Math.max(1, minutes) });
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return t("shell.format.hoursAgo", { count: hours });
	const days = Math.floor(hours / 24);
	return t("shell.format.daysAgo", { count: days });
}
