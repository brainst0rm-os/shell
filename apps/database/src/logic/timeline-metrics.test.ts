import { describe, expect, it } from "vitest";
import { TimelineDensity } from "../types/list-view";
import { itemLabelVisible, timelineMetrics } from "./timeline-metrics";

describe("timelineMetrics", () => {
	it("Comfortable lanes are taller and more spaced than Compact", () => {
		const compact = timelineMetrics(TimelineDensity.Compact);
		const comfortable = timelineMetrics(TimelineDensity.Comfortable);
		expect(comfortable.laneHeight).toBeGreaterThan(compact.laneHeight);
		expect(comfortable.laneGap).toBeGreaterThan(compact.laneGap);
	});

	it("item pill always fits inside its lane", () => {
		for (const d of [TimelineDensity.Compact, TimelineDensity.Comfortable]) {
			const m = timelineMetrics(d);
			expect(m.itemHeight).toBeLessThan(m.laneHeight);
			expect(m.itemHeight).toBeGreaterThan(0);
		}
	});
});

describe("itemLabelVisible", () => {
	it("hides the redundant in-track label in classic-Gantt mode", () => {
		expect(itemLabelVisible(null)).toBe(false);
	});

	it("shows the per-item label when the gutter is a shared swimlane", () => {
		expect(itemLabelVisible("status")).toBe(true);
	});
});
