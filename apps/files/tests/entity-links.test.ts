/**
 * Pure-logic coverage for the Files-inspector Links panel helpers.
 * The render side is covered by the integration build + the Vitest
 * `tests/icons.test.ts` style smoke — these tests pin the partition +
 * label semantics so future link-type additions don't regress.
 */

import { describe, expect, it } from "vitest";
import { type EntityLink, humanLinkType, partitionLinksForEntity } from "../src/logic/entity-links";

const mkLink = (over: Partial<EntityLink>): EntityLink => ({
	id: "lnk_test",
	sourceEntityId: "src",
	destEntityId: "dst",
	linkType: "io.brainstorm.notes/mention",
	...over,
});

describe("partitionLinksForEntity", () => {
	it("returns an empty partition when there are no links", () => {
		const result = partitionLinksForEntity([], "note_a");
		expect(result.outgoing).toEqual([]);
		expect(result.incoming).toEqual([]);
	});

	it("returns a stable frozen partition for the empty case (no allocation per call)", () => {
		const a = partitionLinksForEntity([], "note_a");
		const b = partitionLinksForEntity([], "note_b");
		expect(a).toBe(b);
		expect(Object.isFrozen(a)).toBe(true);
		expect(Object.isFrozen(a.outgoing)).toBe(true);
		expect(Object.isFrozen(a.incoming)).toBe(true);
	});

	it("buckets a link as outgoing when the entity is the source", () => {
		const link = mkLink({ sourceEntityId: "note_a", destEntityId: "note_b" });
		const result = partitionLinksForEntity([link], "note_a");
		expect(result.outgoing).toEqual([link]);
		expect(result.incoming).toEqual([]);
	});

	it("buckets a link as incoming when the entity is the destination", () => {
		const link = mkLink({ sourceEntityId: "note_a", destEntityId: "note_b" });
		const result = partitionLinksForEntity([link], "note_b");
		expect(result.outgoing).toEqual([]);
		expect(result.incoming).toEqual([link]);
	});

	it("treats a self-loop as both outgoing and incoming", () => {
		const link = mkLink({ sourceEntityId: "note_a", destEntityId: "note_a" });
		const result = partitionLinksForEntity([link], "note_a");
		expect(result.outgoing).toEqual([link]);
		expect(result.incoming).toEqual([link]);
	});

	it("excludes links unrelated to the entity", () => {
		const links: EntityLink[] = [
			mkLink({ id: "l1", sourceEntityId: "x", destEntityId: "y" }),
			mkLink({ id: "l2", sourceEntityId: "note_a", destEntityId: "z" }),
		];
		const result = partitionLinksForEntity(links, "note_a");
		expect(result.outgoing).toHaveLength(1);
		expect(result.outgoing[0]?.id).toBe("l2");
		expect(result.incoming).toEqual([]);
	});

	it("preserves input order within each bucket", () => {
		const links: EntityLink[] = [
			mkLink({ id: "l1", sourceEntityId: "note_a", destEntityId: "x" }),
			mkLink({ id: "l2", sourceEntityId: "note_a", destEntityId: "y" }),
			mkLink({ id: "l3", sourceEntityId: "note_a", destEntityId: "z" }),
		];
		const result = partitionLinksForEntity(links, "note_a");
		expect(result.outgoing.map((l) => l.id)).toEqual(["l1", "l2", "l3"]);
	});

	it("does not mutate the input array", () => {
		const links: EntityLink[] = [
			mkLink({ sourceEntityId: "note_a", destEntityId: "note_b" }),
			mkLink({ sourceEntityId: "note_b", destEntityId: "note_a" }),
		];
		const before = [...links];
		partitionLinksForEntity(links, "note_a");
		expect(links).toEqual(before);
	});
});

describe("humanLinkType", () => {
	it("maps `io.brainstorm.notes/mention` → `Mention`", () => {
		expect(humanLinkType("io.brainstorm.notes/mention")).toBe("Mention");
	});

	it("maps `io.brainstorm.notes/link` → `Link`", () => {
		expect(humanLinkType("io.brainstorm.notes/link")).toBe("Link");
	});

	it("falls back to the last `/`-delimited segment for unknown types", () => {
		expect(humanLinkType("io.brainstorm.notes/transclusion")).toBe("Transclusion");
	});

	it("capitalises a bare type with no namespace", () => {
		expect(humanLinkType("custom")).toBe("Custom");
	});

	it("returns an empty string for empty / whitespace input", () => {
		expect(humanLinkType("")).toBe("");
		expect(humanLinkType("   ")).toBe("");
	});

	it("returns an empty string when the type ends in a slash", () => {
		expect(humanLinkType("namespace/")).toBe("");
	});

	it("leaves already-capitalised input intact", () => {
		expect(humanLinkType("Already")).toBe("Already");
	});
});
