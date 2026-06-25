/**
 * Tests for `compileMembership` / `membershipPredicate` / `memberCountOf` —
 * the saved-List → effective-member compiler. The truth table is the
 * Collection contract's `effective = (source ∪ include) \ exclude`, but
 * asserted through the List-shaped front door the renderer actually calls.
 */

import { describe, expect, it } from "vitest";
import type { List } from "../types/list";
import { ListSourceKind } from "../types/list-source";
import { compileMembership, memberCountOf, membershipPredicate } from "./compile-membership";
import type { EntityRow, InMemoryEntities } from "./in-memory-entities";

const NOW = 1_700_000_000_000;

function entity(id: string, type: string, properties: Record<string, unknown> = {}): EntityRow {
	return { id, type, properties, createdAt: 0, updatedAt: 0, deletedAt: null };
}

function makeList(partial: Partial<List> & { id: string; name: string }): List {
	return {
		icon: null,
		description: "",
		source: null,
		members: { include: [], exclude: [] },
		views: [],
		defaultViewId: null,
		defaultTemplate: null,
		createdAt: 0,
		updatedAt: 0,
		...partial,
	};
}

const DB: InMemoryEntities = {
	entities: [
		entity("a", "io.test/Task/v1", { status: "Done" }),
		entity("b", "io.test/Task/v1", { status: "Open" }),
		entity("c", "io.test/Note/v1", {}),
		entity("d", "io.test/Task/v1", { status: "Done" }),
	],
	links: [],
};

describe("compileMembership", () => {
	it("resolves a dynamic byType source to the matching ids", () => {
		const list = makeList({
			id: "L1",
			name: "Tasks",
			source: { kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] },
		});
		expect(Array.from(compileMembership(list, DB)).sort()).toEqual(["a", "b", "d"]);
	});

	it("resolves a byFilter source through the predicate evaluator", () => {
		const list = makeList({
			id: "L2",
			name: "Done",
			source: { kind: ListSourceKind.ByFilter, where: { $eq: { status: "Done" } } },
		});
		expect(Array.from(compileMembership(list, DB)).sort()).toEqual(["a", "d"]);
	});

	it("layers include on top of the source set (source ∪ include)", () => {
		const list = makeList({
			id: "L3",
			name: "Done + Note",
			source: { kind: ListSourceKind.ByFilter, where: { $eq: { status: "Done" } } },
			members: { include: [{ entityId: "c", addedAt: NOW, by: "user" }], exclude: [] },
		});
		expect(Array.from(compileMembership(list, DB)).sort()).toEqual(["a", "c", "d"]);
	});

	it("subtracts exclude after include ((source ∪ include) \\ exclude)", () => {
		const list = makeList({
			id: "L4",
			name: "Done minus a",
			source: { kind: ListSourceKind.ByFilter, where: { $eq: { status: "Done" } } },
			members: { include: [], exclude: [{ entityId: "a", removedAt: NOW, by: "user" }] },
		});
		expect(Array.from(compileMembership(list, DB)).sort()).toEqual(["d"]);
	});

	it("exclude wins over include for the same id (order: ∪ then \\)", () => {
		const list = makeList({
			id: "L5",
			name: "conflict",
			source: null,
			members: {
				include: [{ entityId: "c", addedAt: NOW, by: "user" }],
				exclude: [{ entityId: "c", removedAt: NOW, by: "user" }],
			},
		});
		expect(compileMembership(list, DB).size).toBe(0);
	});

	it("a null source contributes no dynamic members — the pure-Set case", () => {
		const list = makeList({
			id: "L6",
			name: "Hand-picked",
			source: null,
			members: { include: [{ entityId: "b", addedAt: NOW, by: "user" }], exclude: [] },
		});
		expect(Array.from(compileMembership(list, DB))).toEqual(["b"]);
	});

	it("an empty list resolves to no members", () => {
		const list = makeList({ id: "L7", name: "Empty" });
		expect(compileMembership(list, DB).size).toBe(0);
	});
});

describe("membershipPredicate", () => {
	it("returns true only for entities in the effective set", () => {
		const list = makeList({
			id: "L8",
			name: "Done",
			source: { kind: ListSourceKind.ByFilter, where: { $eq: { status: "Done" } } },
		});
		const pred = membershipPredicate(list, DB);
		expect(DB.entities.filter(pred).map((e) => e.id)).toEqual(["a", "d"]);
	});

	it("honours include / exclude overrides through the predicate", () => {
		const list = makeList({
			id: "L9",
			name: "Done + c - a",
			source: { kind: ListSourceKind.ByFilter, where: { $eq: { status: "Done" } } },
			members: {
				include: [{ entityId: "c", addedAt: NOW, by: "user" }],
				exclude: [{ entityId: "a", removedAt: NOW, by: "user" }],
			},
		});
		const pred = membershipPredicate(list, DB);
		expect(
			DB.entities
				.filter(pred)
				.map((e) => e.id)
				.sort(),
		).toEqual(["c", "d"]);
	});
});

describe("memberCountOf", () => {
	it("equals the size of the effective member set", () => {
		const list = makeList({
			id: "L10",
			name: "Tasks",
			source: { kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] },
		});
		expect(memberCountOf(list, DB)).toBe(3);
	});

	it("is zero for an empty list", () => {
		expect(memberCountOf(makeList({ id: "L11", name: "Empty" }), DB)).toBe(0);
	});
});
