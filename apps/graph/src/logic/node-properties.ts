/**
 * Inspector property rows (9.13.11, read-only slice) — the node card's
 * "Name: Alice · City: Berlin" section per
 *  §Inspector panel. Pure: picks
 * the human-meaningful properties off an entity's bag, formats scalars,
 * and caps row count + value length so a content-heavy entity can't blow
 * the card. The editable inspector (shared property cells over
 * `entities.write`) is the follow-on; this slice surfaces the values.
 */

import type { EntityRow } from "./in-memory-graph";

export type InspectorRow = {
	/** Humanised property key ("dueAt" → "Due at"). */
	label: string;
	value: string;
};

/** Keys that aren't user-meaningful in a glance card: identity/visual
 *  chrome, denormalised blobs, and the body/values containers other
 *  surfaces own. */
const SKIPPED_KEYS: ReadonlySet<string> = new Set([
	"id",
	"name",
	"title",
	"body",
	"bodyRefs",
	"values",
	"icon",
	"cover",
	"snippet",
	"preview",
	"members",
]);

export const MAX_INSPECTOR_ROWS = 6;
const MAX_VALUE_LENGTH = 60;

/** "dueAt" / "due_at" / "due-at" → "Due at". */
export function humaniseKey(key: string): string {
	const spaced = key
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[-_]+/g, " ")
		.trim()
		.toLowerCase();
	return spaced.length > 0 ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

/** Epoch-ms heuristic: a finite number in the 2001–2096 range reads as a
 *  timestamp and formats as a local date; other numbers print verbatim. */
function looksLikeEpochMs(value: number): boolean {
	return Number.isFinite(value) && value > 1_000_000_000_000 && value < 4_000_000_000_000;
}

/** ISO-8601 date / date-time (`2026-06-09` or `2026-06-09T14:30:00.000Z`).
 *  Real property bags store dates as strings far more often than epoch-ms,
 *  and the raw 24-char ISO string is a poor glance value (it just gets
 *  clipped). Anchored + length-bounded so it can't misfire on prose. */
const ISO_DATE_RE =
	/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function formatIsoDateString(value: string): string | null {
	if (!ISO_DATE_RE.test(value)) return null;
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? null : new Date(ms).toLocaleDateString();
}

function formatScalar(value: unknown): string | null {
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.length === 0) return null;
		const asDate = formatIsoDateString(trimmed);
		return asDate ?? trimmed;
	}
	if (typeof value === "number") {
		if (looksLikeEpochMs(value)) return new Date(value).toLocaleDateString();
		return Number.isFinite(value) ? String(value) : null;
	}
	if (typeof value === "boolean") return value ? "✓" : "✗";
	return null;
}

function clip(text: string): string {
	return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH - 1)}…` : text;
}

/** The read-only property rows for the node card, in the bag's own key
 *  order, capped at `MAX_INSPECTOR_ROWS`. Objects/arrays-of-objects and
 *  empty values drop — the card glances, the owning app edits. */
export function inspectorProperties(entity: EntityRow): InspectorRow[] {
	const out: InspectorRow[] = [];
	for (const [key, raw] of Object.entries(entity.properties)) {
		if (out.length >= MAX_INSPECTOR_ROWS) break;
		if (SKIPPED_KEYS.has(key)) continue;
		let value: string | null;
		if (Array.isArray(raw)) {
			const parts = raw
				.map((item) => formatScalar(item))
				.filter((part): part is string => part !== null);
			value = parts.length > 0 ? parts.join(", ") : null;
		} else {
			value = formatScalar(raw);
		}
		if (value === null) continue;
		out.push({ label: humaniseKey(key), value: clip(value) });
	}
	return out;
}
