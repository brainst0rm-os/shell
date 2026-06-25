import { describe, expect, it } from "vitest";
import {
	DEFAULT_SHARED_PROPERTY_RULES,
	type SharedPropertyRule,
	deriveSharedPropertyLinks,
} from "./derive-shared-property-links";
import type { VaultEntity } from "./vault-entities-service";

function entity(id: string, type: string, properties: Record<string, unknown>): VaultEntity {
	return {
		id,
		type,
		properties,
		createdAt: 1,
		updatedAt: 1,
		deletedAt: null,
		ownerAppId: "io.test",
	};
}

const BOOKMARK = "brainstorm/Bookmark/v1";
const DESIGN_DOC = "brainstorm/DesignDoc/v1";

describe("deriveSharedPropertyLinks — pure projection", () => {
	it("returns no edges for an empty entity set", () => {
		expect(deriveSharedPropertyLinks([])).toEqual([]);
	});

	it("emits one edge between two bookmarks that share a single tag", () => {
		const links = deriveSharedPropertyLinks([
			entity("b1", BOOKMARK, { tags: ["crdt", "yjs"] }),
			entity("b2", BOOKMARK, { tags: ["crdt"] }),
		]);
		expect(links).toHaveLength(1);
		expect(links[0]).toMatchObject({
			sourceEntityId: "b1",
			destEntityId: "b2",
			linkType: "brainstorm/shared-property/Bookmark.tags",
		});
	});

	it("emits ONE edge per pair even when two tags are shared (rule-level dedupe)", () => {
		const links = deriveSharedPropertyLinks([
			entity("b1", BOOKMARK, { tags: ["crdt", "yjs"] }),
			entity("b2", BOOKMARK, { tags: ["crdt", "yjs", "extra"] }),
		]);
		expect(links).toHaveLength(1);
	});

	it("emits a fully-connected mesh inside a 3-entity bucket (N*(N-1)/2)", () => {
		const links = deriveSharedPropertyLinks([
			entity("b1", BOOKMARK, { tags: ["x"] }),
			entity("b2", BOOKMARK, { tags: ["x"] }),
			entity("b3", BOOKMARK, { tags: ["x"] }),
		]);
		expect(links).toHaveLength(3);
		const pairs = links.map((l) => [l.sourceEntityId, l.destEntityId].sort().join(":")).sort();
		expect(pairs).toEqual(["b1:b2", "b1:b3", "b2:b3"]);
	});

	it("edge id is stable and direction-independent (sorts the pair)", () => {
		const a = deriveSharedPropertyLinks([
			entity("z", BOOKMARK, { tags: ["x"] }),
			entity("a", BOOKMARK, { tags: ["x"] }),
		]);
		const b = deriveSharedPropertyLinks([
			entity("a", BOOKMARK, { tags: ["x"] }),
			entity("z", BOOKMARK, { tags: ["x"] }),
		]);
		expect(a[0]?.id).toBe(b[0]?.id);
		// Lexicographic order — the lo end comes first in the id.
		expect(a[0]?.id).toContain("_a_z");
	});

	it("drops buckets larger than the rule cap (noise prevention)", () => {
		const rule: SharedPropertyRule = {
			linkType: "test/shared/cap",
			entityTypes: [BOOKMARK],
			propertyPath: "tags",
			arrayValued: true,
			maxGroupSize: 3,
		};
		// 4-entity bucket exceeds the cap → 0 edges.
		const overCap = deriveSharedPropertyLinks(
			[
				entity("b1", BOOKMARK, { tags: ["x"] }),
				entity("b2", BOOKMARK, { tags: ["x"] }),
				entity("b3", BOOKMARK, { tags: ["x"] }),
				entity("b4", BOOKMARK, { tags: ["x"] }),
			],
			[rule],
		);
		expect(overCap).toHaveLength(0);

		// 3-entity bucket sits at the cap → emitted (3 edges).
		const atCap = deriveSharedPropertyLinks(
			[
				entity("b1", BOOKMARK, { tags: ["x"] }),
				entity("b2", BOOKMARK, { tags: ["x"] }),
				entity("b3", BOOKMARK, { tags: ["x"] }),
			],
			[rule],
		);
		expect(atCap).toHaveLength(3);
	});

	it("respects entityTypes — only same-type pairs match", () => {
		const links = deriveSharedPropertyLinks([
			entity("b1", BOOKMARK, { tags: ["data"] }),
			entity("d1", DESIGN_DOC, { category: "data", tags: ["data"] }),
		]);
		// `Bookmark.tags` rule sees only b1 (single → no edge).
		// `DesignDoc.category` rule sees only d1 (single → no edge).
		// No cross-type "tag-matches-category" coincidence edge.
		expect(links).toEqual([]);
	});

	it("scalar properties pair on equality (DesignDoc category)", () => {
		const links = deriveSharedPropertyLinks([
			entity("d1", DESIGN_DOC, { category: "foundations" }),
			entity("d2", DESIGN_DOC, { category: "foundations" }),
			entity("d3", DESIGN_DOC, { category: "shell" }),
		]);
		const cat = links.filter((l) => l.linkType === "brainstorm/shared-property/DesignDoc.category");
		expect(cat).toHaveLength(1);
		expect([cat[0]?.sourceEntityId, cat[0]?.destEntityId].sort()).toEqual(["d1", "d2"]);
	});

	it("ignores empty / non-string / wrong-shape property values", () => {
		const links = deriveSharedPropertyLinks([
			entity("b1", BOOKMARK, { tags: ["", null, 3, "real"] as unknown[] }),
			entity("b2", BOOKMARK, { tags: ["real"] }),
			entity("b3", BOOKMARK, { tags: [] }),
			entity("b4", BOOKMARK, { tags: null }),
			entity("b5", BOOKMARK, {}),
		]);
		expect(links).toHaveLength(1);
		expect([links[0]?.sourceEntityId, links[0]?.destEntityId].sort()).toEqual(["b1", "b2"]);
	});

	it("a non-string scalar (e.g. number 0) doesn't bucket-collide on stringified value", () => {
		const rule: SharedPropertyRule = {
			linkType: "test/scalar",
			entityTypes: [BOOKMARK],
			propertyPath: "category",
			arrayValued: false,
			maxGroupSize: 12,
		};
		const links = deriveSharedPropertyLinks(
			[entity("b1", BOOKMARK, { category: 0 }), entity("b2", BOOKMARK, { category: "0" })],
			[rule],
		);
		expect(links).toEqual([]);
	});

	it("default rules cover Bookmark.tags, DesignDoc.category, OpenQuestion.section, Stage.ownerDomain", () => {
		const linkTypes = DEFAULT_SHARED_PROPERTY_RULES.map((r) => r.linkType);
		// Person.company was removed — Company is a real entity now, so people
		// connect through a `Person → Company` reference, not a shared string.
		expect(linkTypes).toEqual([
			"brainstorm/shared-property/Bookmark.tags",
			"brainstorm/shared-property/DesignDoc.category",
			"brainstorm/shared-property/OpenQuestion.section",
			"brainstorm/shared-property/Stage.ownerDomain",
		]);
		for (const r of DEFAULT_SHARED_PROPERTY_RULES) {
			expect(r.maxGroupSize).toBeGreaterThan(0);
			expect(r.entityTypes.length).toBeGreaterThan(0);
		}
	});

	it("default rules: OpenQuestion in same section get paired", () => {
		const links = deriveSharedPropertyLinks([
			entity("oq1", "brainstorm/OpenQuestion/v1", { section: "GR" }),
			entity("oq2", "brainstorm/OpenQuestion/v1", { section: "GR" }),
			entity("oq3", "brainstorm/OpenQuestion/v1", { section: "MB" }),
		]);
		const grLinks = links.filter(
			(l) => l.linkType === "brainstorm/shared-property/OpenQuestion.section",
		);
		expect(grLinks).toHaveLength(1);
		expect([grLinks[0]?.sourceEntityId, grLinks[0]?.destEntityId].sort()).toEqual(["oq1", "oq2"]);
	});

	it("deterministic output: two runs on the same input produce identical link arrays", () => {
		const ents = [
			entity("b3", BOOKMARK, { tags: ["x", "y"] }),
			entity("b1", BOOKMARK, { tags: ["x"] }),
			entity("b2", BOOKMARK, { tags: ["x", "y"] }),
		];
		const run1 = deriveSharedPropertyLinks(ents);
		const run2 = deriveSharedPropertyLinks(ents);
		expect(run1).toEqual(run2);
	});
});
