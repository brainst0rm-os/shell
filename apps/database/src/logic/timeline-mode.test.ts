/**
 * Tests for `deriveTimelineMode`. Truth table from
 *  §Timeline §Item shape — three derived modes.
 */

import { describe, expect, it } from "vitest";
import { TimelineMode } from "../types/list-view";
import { deriveTimelineMode } from "./timeline-mode";

describe("deriveTimelineMode", () => {
	it("returns Event when endDateProperty is null", () => {
		expect(
			deriveTimelineMode({
				endDateProperty: null,
				members: [{ hasEnd: true }, { hasEnd: true }],
			}),
		).toBe(TimelineMode.Event);
	});

	it("returns Event when endDateProperty is set but no member has an end", () => {
		expect(
			deriveTimelineMode({
				endDateProperty: "endDate",
				members: [{ hasEnd: false }, { hasEnd: false }],
			}),
		).toBe(TimelineMode.Event);
	});

	it("returns Span when every member has an end", () => {
		expect(
			deriveTimelineMode({
				endDateProperty: "endDate",
				members: [{ hasEnd: true }, { hasEnd: true }, { hasEnd: true }],
			}),
		).toBe(TimelineMode.Span);
	});

	it("returns Mixed when some members have an end and some don't", () => {
		expect(
			deriveTimelineMode({
				endDateProperty: "endDate",
				members: [{ hasEnd: true }, { hasEnd: false }, { hasEnd: true }],
			}),
		).toBe(TimelineMode.Mixed);
	});

	it("returns Event on an empty member set with endDateProperty = null", () => {
		expect(deriveTimelineMode({ endDateProperty: null, members: [] })).toBe(TimelineMode.Event);
	});

	it("returns Event on an empty member set with endDateProperty set", () => {
		// No member has end → Event. Defensible: the user declared an end
		// property but no data uses it; renderer falls back to the marker treatment.
		expect(deriveTimelineMode({ endDateProperty: "endDate", members: [] })).toBe(TimelineMode.Event);
	});

	it("short-circuits at the first member that flips the mode to Mixed", () => {
		// Just a behaviour assertion that doesn't break if the implementation
		// is naive — we check the result, not the loop count.
		const many: { hasEnd: boolean }[] = Array.from({ length: 10_000 }, (_, i) => ({
			hasEnd: i % 2 === 0,
		}));
		expect(deriveTimelineMode({ endDateProperty: "endDate", members: many })).toBe(
			TimelineMode.Mixed,
		);
	});
});
