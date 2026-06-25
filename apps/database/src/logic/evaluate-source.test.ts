/**
 * Tests for `evaluateSource` + `applyMemberOverrides`. Mirrors the truth
 * table the entities service will enforce at Stage 9.3: source resolves
 * an entity id set; include layers it on top; exclude subtracts after.
 * Order matters: `effective(L) = (source ∪ include) \ exclude`.
 */

import { describe, expect, it } from "vitest";
import { CompositeOp, LinkDirection, ListSourceKind } from "../types/list-source";
import { applyMemberOverrides, evaluateSource } from "./evaluate-source";
import type { EntityRow, InMemoryEntities, LinkRow } from "./in-memory-entities";

function entity(id: string, type: string, properties: Record<string, unknown> = {}): EntityRow {
	return { id, type, properties, createdAt: 0, updatedAt: 0, deletedAt: null };
}

function link(id: string, source: string, dest: string, linkType: string): LinkRow {
	return { id, sourceEntityId: source, destEntityId: dest, linkType, createdAt: 0, deletedAt: null };
}

const DB: InMemoryEntities = {
	entities: [
		entity("a", "io.test/Task/v1", { status: "Done" }),
		entity("b", "io.test/Task/v1", { status: "Open" }),
		entity("c", "io.test/Note/v1", {}),
		entity("d", "io.test/Task/v1", { status: "Done" }),
	],
	links: [link("l1", "a", "c", "io.test/About/v1"), link("l2", "b", "c", "io.test/About/v1")],
};

describe("evaluateSource", () => {
	it("byType collects entities of the listed types and skips deleted", () => {
		const ids = evaluateSource({ kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] }, DB);
		expect(Array.from(ids).sort()).toEqual(["a", "b", "d"]);
	});

	it("byFilter applies the predicate over every entity", () => {
		const ids = evaluateSource(
			{ kind: ListSourceKind.ByFilter, where: { $eq: { status: "Done" } } },
			DB,
		);
		expect(Array.from(ids).sort()).toEqual(["a", "d"]);
	});

	it("byLink Out returns the destination of links from the anchor", () => {
		const ids = evaluateSource(
			{
				kind: ListSourceKind.ByLink,
				linkType: "io.test/About/v1",
				direction: LinkDirection.Out,
				anchorEntityId: "a",
			},
			DB,
		);
		expect(Array.from(ids)).toEqual(["c"]);
	});

	it("byLink In returns the source of inbound links", () => {
		const ids = evaluateSource(
			{
				kind: ListSourceKind.ByLink,
				linkType: "io.test/About/v1",
				direction: LinkDirection.In,
				anchorEntityId: "c",
			},
			DB,
		);
		expect(Array.from(ids).sort()).toEqual(["a", "b"]);
	});

	it("byLink unions destinations across multiple anchors (OQ-LD-1 (b))", () => {
		// Out from a OR d: a→c links; d has no About link, so only c. Add a
		// second About link to prove the union (e→f) lands too.
		const db: InMemoryEntities = {
			entities: [...DB.entities, entity("e", "io.test/Task/v1"), entity("f", "io.test/Note/v1")],
			links: [...DB.links, link("l3", "e", "f", "io.test/About/v1")],
		};
		const ids = evaluateSource(
			{
				kind: ListSourceKind.ByLink,
				linkType: "io.test/About/v1",
				direction: LinkDirection.Out,
				anchorEntityIds: ["a", "e"],
			},
			db,
		);
		expect(Array.from(ids).sort()).toEqual(["c", "f"]);
	});

	it("byLink unions the legacy single anchor with the multi list", () => {
		const ids = evaluateSource(
			{
				kind: ListSourceKind.ByLink,
				linkType: "io.test/About/v1",
				direction: LinkDirection.In,
				anchorEntityId: "c",
				anchorEntityIds: [],
			},
			DB,
		);
		// `c` (legacy field) still resolves its inbound sources a + b.
		expect(Array.from(ids).sort()).toEqual(["a", "b"]);
	});

	it("byLink with no anchor at all resolves to nothing", () => {
		const ids = evaluateSource(
			{ kind: ListSourceKind.ByLink, linkType: "io.test/About/v1", direction: LinkDirection.Out },
			DB,
		);
		expect(ids.size).toBe(0);
	});

	it("composite AND intersects child sets", () => {
		const ids = evaluateSource(
			{
				kind: ListSourceKind.Composite,
				op: CompositeOp.And,
				sources: [
					{ kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] },
					{ kind: ListSourceKind.ByFilter, where: { $eq: { status: "Done" } } },
				],
			},
			DB,
		);
		expect(Array.from(ids).sort()).toEqual(["a", "d"]);
	});

	it("composite OR unions child sets", () => {
		const ids = evaluateSource(
			{
				kind: ListSourceKind.Composite,
				op: CompositeOp.Or,
				sources: [
					{ kind: ListSourceKind.ByType, types: ["io.test/Note/v1"] },
					{ kind: ListSourceKind.ByFilter, where: { $eq: { status: "Open" } } },
				],
			},
			DB,
		);
		expect(Array.from(ids).sort()).toEqual(["b", "c"]);
	});

	it("null source returns an empty set", () => {
		expect(Array.from(evaluateSource(null, DB))).toEqual([]);
	});
});

describe("applyMemberOverrides", () => {
	it("union with include", () => {
		const base = new Set(["a", "b"]);
		const out = applyMemberOverrides(base, [{ entityId: "c" }, { entityId: "a" }], []);
		expect(Array.from(out).sort()).toEqual(["a", "b", "c"]);
	});

	it("subtraction with exclude", () => {
		const base = new Set(["a", "b", "c"]);
		const out = applyMemberOverrides(base, [], [{ entityId: "b" }]);
		expect(Array.from(out).sort()).toEqual(["a", "c"]);
	});

	it("include then exclude — exclude wins", () => {
		const base = new Set(["a"]);
		const out = applyMemberOverrides(base, [{ entityId: "b" }], [{ entityId: "a" }]);
		expect(Array.from(out)).toEqual(["b"]);
	});

	it("empty inputs return the source unchanged", () => {
		const base = new Set(["a"]);
		const out = applyMemberOverrides(base, [], []);
		expect(Array.from(out)).toEqual(["a"]);
	});
});
