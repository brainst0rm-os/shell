/**
 * Pick a sensible group/date property from the data so a freshly
 * switched Board/Calendar/Timeline view renders something instead of
 * blank (Board needs `view.groupBy`; Calendar uses it as its date axis;
 * Timeline binds `layoutOptions.primaryDateProperty` — F-211).
 *
 * Board → a low-cardinality string property, preferring status/
 * priority-like names. Calendar/Timeline → a timestamp property,
 * preferring scheduled/due/date-like names. Pure — unit-tested.
 */

import type { EntityRow } from "./in-memory-entities";

const CALENDAR_PREF = [
	"scheduledat",
	"dueat",
	"date",
	"start",
	"startsat",
	"createdat",
	"updatedat",
];
const BOARD_PREF = ["status", "priority", "stage", "state", "category", "kind", "type"];

/**
 * Date-typed property keys present in the data, best-first: known
 * scheduling names (`CALENDAR_PREF`) rank ahead of inferred timestamp
 * columns; ties keep first-seen property order so the pick is
 * deterministic. Feeds the Calendar auto-axis AND the Timeline
 * primary-date auto-bind (F-211).
 */
export function datePropertyCandidates(entities: ReadonlyArray<EntityRow>): string[] {
	const values = collectValues(entities);
	const dateKeys = [...values.entries()].filter(
		([k, vs]) =>
			CALENDAR_PREF.includes(k.toLowerCase()) ||
			vs.some((v) => typeof v === "number" && v > 1_000_000_000_000),
	);
	dateKeys.sort(
		([a], [b]) =>
			(CALENDAR_PREF.indexOf(a.toLowerCase()) + 1 || 99) -
			(CALENDAR_PREF.indexOf(b.toLowerCase()) + 1 || 99),
	);
	return dateKeys.map(([k]) => k);
}

function collectValues(entities: ReadonlyArray<EntityRow>): Map<string, unknown[]> {
	const values = new Map<string, unknown[]>();
	for (const e of entities) {
		for (const [k, v] of Object.entries(e.properties)) {
			if (v === null || v === undefined || v === "") continue;
			const arr = values.get(k) ?? [];
			if (arr.length < 64) arr.push(v);
			values.set(k, arr);
		}
	}
	return values;
}

export function autoGroupBy(
	isCalendar: boolean,
	entities: ReadonlyArray<EntityRow>,
): { propertyId: string } | null {
	if (isCalendar) {
		const first = datePropertyCandidates(entities)[0];
		return first ? { propertyId: first } : null;
	}

	const values = collectValues(entities);
	const cands = [...values.entries()].filter(([, vs]) => {
		const distinct = new Set(vs);
		return distinct.size > 1 && distinct.size <= 12 && vs.every((v) => typeof v === "string");
	});
	cands.sort(([a, av], [b, bv]) => {
		const pa = BOARD_PREF.indexOf(a.toLowerCase()) + 1 || 99;
		const pb = BOARD_PREF.indexOf(b.toLowerCase()) + 1 || 99;
		return pa !== pb ? pa - pb : new Set(av).size - new Set(bv).size;
	});
	const first = cands[0];
	return first ? { propertyId: first[0] } : null;
}
