/**
 * Pure layout metrics for the Timeline view. Kept out of the DOM renderer
 * so the density → row-geometry mapping is unit-testable under the node
 * vitest env (same split as `timeline-mode.ts`).
 *
 * Spec: §Timeline §Density.
 */

import { TimelineDensity } from "../types/list-view";

export type TimelineMetrics = {
	laneHeight: number;
	laneGap: number;
	/** Bar / marker pill height — always inset within the lane. */
	itemHeight: number;
};

export function timelineMetrics(density: TimelineDensity): TimelineMetrics {
	if (density === TimelineDensity.Compact) {
		return { laneHeight: 24, laneGap: 2, itemHeight: 18 };
	}
	return { laneHeight: 36, laneGap: 8, itemHeight: 26 };
}

/**
 * In classic Gantt mode (`swimlaneBy: null`) every item gets its own lane
 * and the gutter already shows the entity title — repeating it on the
 * marker/bar is redundant noise. Only show the in-track label when the
 * gutter is showing a *swimlane* (a shared bucket), where the per-item
 * title still adds information.
 */
export function itemLabelVisible(swimlaneBy: string | null): boolean {
	return swimlaneBy !== null;
}
