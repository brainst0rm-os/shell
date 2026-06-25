import { describe, expect, it } from "vitest";
import { emptyLegendCounts, legendCounts } from "./legend-stats";
import { LinkCategory } from "./link-reason";

describe("legendCounts (legend edge tallies)", () => {
	it("starts every category at zero", () => {
		const counts = emptyLegendCounts();
		expect(counts).toEqual({
			[LinkCategory.BodyLink]: 0,
			[LinkCategory.PropertyReference]: 0,
			[LinkCategory.SharedAttribute]: 0,
		});
	});

	it("returns a zeroed tally for an empty edge set", () => {
		expect(legendCounts([])).toEqual(emptyLegendCounts());
	});

	it("classifies each edge into its reason category", () => {
		const counts = legendCounts([
			{ linkType: "io.brainstorm.notes/mention" },
			{ linkType: "io.brainstorm.notes/link" },
			{ linkType: "brainstorm/Task/in-project" },
			{ linkType: "brainstorm/shared-property/Person.company" },
		]);
		expect(counts[LinkCategory.BodyLink]).toBe(2);
		expect(counts[LinkCategory.PropertyReference]).toBe(1);
		expect(counts[LinkCategory.SharedAttribute]).toBe(1);
	});

	it("keeps absent categories at zero while present ones tally", () => {
		const counts = legendCounts([
			{ linkType: "brainstorm/shared-property/Note.tags" },
			{ linkType: "brainstorm/shared-property/Note.tags" },
			{ linkType: "brainstorm/shared-property/Note.tags" },
		]);
		expect(counts).toEqual({
			[LinkCategory.BodyLink]: 0,
			[LinkCategory.PropertyReference]: 0,
			[LinkCategory.SharedAttribute]: 3,
		});
	});

	it("accepts any iterable of categorizable links", () => {
		const set = new Set([
			{ linkType: "io.brainstorm.notes/mention" },
			{ linkType: "brainstorm/Task/in-project" },
		]);
		const counts = legendCounts(set);
		expect(counts[LinkCategory.BodyLink]).toBe(1);
		expect(counts[LinkCategory.PropertyReference]).toBe(1);
	});
});
