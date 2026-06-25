/**
 * Derive `TimelineMode` from a timeline view's config plus the values
 * observed on its visible members. The mode is not stored — same pattern
 * as `deriveListMode`.
 *
 * Spec: docs/apps/database/20-views.md §Timeline §Item shape — three derived
 * modes.
 *
 *   endDateProperty   any member has end?   any member missing end?   → mode
 *   ──────────────────────────────────────────────────────────────────────────
 *   null              n/a                   n/a                       → Event
 *   set               no                    yes                       → Event
 *   set               yes                   no                        → Span
 *   set               yes                   yes                       → Mixed
 */

import { TimelineMode } from "../types/list-view";

export type TimelineMemberSample = {
	hasEnd: boolean;
};

export type TimelineModeInputs = {
	endDateProperty: string | null;
	members: TimelineMemberSample[];
};

export function deriveTimelineMode(inputs: TimelineModeInputs): TimelineMode {
	if (inputs.endDateProperty === null) return TimelineMode.Event;

	let anyWithEnd = false;
	let anyWithoutEnd = false;
	for (const m of inputs.members) {
		if (m.hasEnd) anyWithEnd = true;
		else anyWithoutEnd = true;
		if (anyWithEnd && anyWithoutEnd) break;
	}

	if (!anyWithEnd) return TimelineMode.Event;
	if (!anyWithoutEnd) return TimelineMode.Span;
	return TimelineMode.Mixed;
}
