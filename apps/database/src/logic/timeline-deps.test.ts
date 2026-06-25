/**
 * Tests for the 9.12.10 dependency-edge resolver — type allow-list,
 * both-ends-visible gate, self-edge drop, pair de-dup.
 */

import { describe, expect, it } from "vitest";
import { dependencyEdges } from "./timeline-deps";

const link = (from: string, to: string, type = "depends-on") => ({
	sourceEntityId: from,
	destEntityId: to,
	linkType: type,
});

const VISIBLE = new Set(["a", "b", "c"]);

describe("dependencyEdges", () => {
	it("resolves links of an allowed type between visible items", () => {
		expect(dependencyEdges(VISIBLE, [link("a", "b")], ["depends-on"])).toEqual([
			{ fromId: "a", toId: "b" },
		]);
	});

	it("ignores links of a non-allowed type", () => {
		expect(dependencyEdges(VISIBLE, [link("a", "b", "mentions")], ["depends-on"])).toEqual([]);
	});

	it("drops edges with an off-timeline endpoint", () => {
		expect(dependencyEdges(VISIBLE, [link("a", "zz"), link("zz", "b")], ["depends-on"])).toEqual([]);
	});

	it("drops self-edges and de-duplicates repeated pairs", () => {
		const edges = dependencyEdges(
			VISIBLE,
			[link("a", "a"), link("a", "b"), link("a", "b", "blocks")],
			["depends-on", "blocks"],
		);
		expect(edges).toEqual([{ fromId: "a", toId: "b" }]);
	});

	it("an empty allow-list resolves to no edges", () => {
		expect(dependencyEdges(VISIBLE, [link("a", "b")], [])).toEqual([]);
	});
});
