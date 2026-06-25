import { describe, expect, it } from "vitest";
import { EdgeDirection, EdgeMatch, PATTERN_MAX_SUBJECTS } from "../types/pattern";
import type { InMemoryGraph } from "./in-memory-graph";
import {
	HOP_WINDOW_PRESETS,
	addEdge,
	addSubject,
	availableEntityTypes,
	availableLinkTypes,
	canAddSubject,
	defaultPattern,
	hopsKey,
	hopsOptionsFor,
	parseHopsKey,
	primarySubjectKey,
	removeEdge,
	removeSubject,
	subjectCount,
	typeShortLabel,
	updateEdge,
	updateSubject,
} from "./pattern-edit";

describe("pattern-edit helpers", () => {
	it("defaultPattern is one any-type subject, no edges", () => {
		const p = defaultPattern();
		expect(subjectCount(p)).toBe(1);
		expect(p.subjects.S1?.types).toEqual([]);
		expect(p.edges).toEqual([]);
		expect(p.primarySubject).toBe("S1");
	});

	it("addSubject appends a fresh keyed subject immutably", () => {
		const p0 = defaultPattern();
		const p1 = addSubject(p0);
		expect(subjectCount(p0)).toBe(1); // original untouched
		expect(subjectCount(p1)).toBe(2);
		expect(Object.keys(p1.subjects)).toEqual(["S1", "S2"]);
	});

	it("respects the subject cap", () => {
		let p = defaultPattern();
		while (canAddSubject(p)) p = addSubject(p);
		expect(subjectCount(p)).toBe(PATTERN_MAX_SUBJECTS);
		const capped = addSubject(p);
		expect(capped).toBe(p); // no-op returns same ref
	});

	it("removeSubject drops referencing edges and fixes primarySubject", () => {
		let p = addSubject(defaultPattern()); // S1, S2
		p = addEdge(p); // S1 -> S2
		p = { ...p, primarySubject: "S2" };
		const after = removeSubject(p, "S2");
		expect(Object.keys(after.subjects)).toEqual(["S1"]);
		expect(after.edges).toEqual([]);
		expect(after.primarySubject).toBe("S1");
	});

	it("removeSubject never empties the pattern", () => {
		const p = defaultPattern();
		expect(removeSubject(p, "S1")).toBe(p);
	});

	it("updateSubject shallow-merges a patch", () => {
		const p = updateSubject(defaultPattern(), "S1", {
			displayName: "People",
			types: ["io.x/Person/v1"],
		});
		expect(p.subjects.S1?.displayName).toBe("People");
		expect(p.subjects.S1?.types).toEqual(["io.x/Person/v1"]);
	});

	it("addEdge wires the first two subjects with required/out defaults", () => {
		const p = addEdge(addSubject(defaultPattern()));
		expect(p.edges).toHaveLength(1);
		expect(p.edges[0]).toMatchObject({
			from: "S1",
			to: "S2",
			direction: EdgeDirection.Out,
			match: EdgeMatch.Required,
			linkTypes: [],
		});
	});

	it("updateEdge / removeEdge are immutable and bounds-checked", () => {
		const p = addEdge(addSubject(defaultPattern()));
		const updated = updateEdge(p, 0, { match: EdgeMatch.Forbidden });
		expect(p.edges[0]?.match).toBe(EdgeMatch.Required);
		expect(updated.edges[0]?.match).toBe(EdgeMatch.Forbidden);
		expect(removeEdge(p, 5)).toBe(p);
		expect(removeEdge(p, 0).edges).toHaveLength(0);
	});

	it("enumerates vault types by frequency, excluding soft-deleted", () => {
		const db: InMemoryGraph = {
			entities: [
				{ id: "a", type: "io.x/Note/v1", properties: {}, createdAt: 0, updatedAt: 0, deletedAt: null },
				{ id: "b", type: "io.x/Note/v1", properties: {}, createdAt: 0, updatedAt: 0, deletedAt: null },
				{ id: "c", type: "io.x/Tag/v1", properties: {}, createdAt: 0, updatedAt: 0, deletedAt: null },
				{ id: "d", type: "io.x/Gone/v1", properties: {}, createdAt: 0, updatedAt: 0, deletedAt: 5 },
			],
			links: [
				{
					id: "l1",
					sourceEntityId: "a",
					destEntityId: "c",
					linkType: "io.x/tagged/v1",
					createdAt: 0,
					deletedAt: null,
				},
				{
					id: "l2",
					sourceEntityId: "b",
					destEntityId: "c",
					linkType: "io.x/tagged/v1",
					createdAt: 0,
					deletedAt: null,
				},
				{
					id: "l3",
					sourceEntityId: "a",
					destEntityId: "b",
					linkType: "io.x/dead/v1",
					createdAt: 0,
					deletedAt: 9,
				},
			],
		};
		expect(availableEntityTypes(db)).toEqual([
			{ type: "io.x/Note/v1", count: 2 },
			{ type: "io.x/Tag/v1", count: 1 },
		]);
		expect(availableLinkTypes(db)).toEqual([{ type: "io.x/tagged/v1", count: 2 }]);
	});

	it("typeShortLabel extracts the readable segment", () => {
		expect(typeShortLabel("io.brainstorm.notes/Note/v1")).toBe("Note");
		expect(typeShortLabel("weird")).toBe("weird");
	});

	it("primarySubjectKey returns the primary, or falls back to the first subject", () => {
		// Default pattern: primary is S1 and present.
		expect(primarySubjectKey(defaultPattern())).toBe("S1");
		// Two subjects, primary explicitly the second.
		const two = addSubject(defaultPattern());
		const keys = Object.keys(two.subjects);
		const repointed = { ...two, primarySubject: keys[1] as string };
		expect(primarySubjectKey(repointed)).toBe(keys[1]);
		// Drifted primary (not in subjects) → first subject, never empty.
		const drifted = { ...two, primarySubject: "S99" };
		expect(primarySubjectKey(drifted)).toBe(keys[0]);
	});
});

describe("hop windows (9.13.4)", () => {
	it("round-trips preset keys and rejects junk / out-of-range", () => {
		expect(parseHopsKey(hopsKey([1, 3]))).toEqual([1, 3]);
		expect(parseHopsKey("0-2")).toBeNull();
		expect(parseHopsKey("3-2")).toBeNull();
		expect(parseHopsKey("1-7")).toBeNull();
		expect(parseHopsKey("a-b")).toBeNull();
		expect(parseHopsKey("1")).toBeNull();
	});

	it("options list the presets, plus a custom current window once", () => {
		expect(hopsOptionsFor([1, 1])).toEqual(HOP_WINDOW_PRESETS);
		const custom = hopsOptionsFor([3, 4]);
		expect(custom.length).toBe(HOP_WINDOW_PRESETS.length + 1);
		expect(custom[custom.length - 1]).toEqual([3, 4]);
	});
});
