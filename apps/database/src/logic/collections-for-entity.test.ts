/**
 * Tests for `collectionsForEntity` — the reverse-lookup half of the
 * Collection contract. Round-trips with `addToList` / `removeFromList`:
 * the membership-kind a `MemberOverrides` mutation produces matches what
 * this reverse query reports next read.
 */

import { describe, expect, it } from "vitest";
import type { List } from "../types/list";
import { ListSourceKind } from "../types/list-source";
import {
	MembershipKind,
	collectionsForEntity,
	membershipKindFor,
	pickerCandidatesForEntity,
	sourceMatches,
} from "./collections-for-entity";
import type { EntityRow, InMemoryEntities } from "./in-memory-entities";
import { addToList, removeFromList } from "./members";

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

describe("collectionsForEntity / membershipKindFor", () => {
	it("returns nothing when no list relates to the entity", () => {
		const lists = [makeList({ id: "L1", name: "Manual" })]; // null source + empty overrides
		expect(collectionsForEntity("a", lists, DB)).toEqual([]);
	});

	it("tags Source when the source query matches with no overrides", () => {
		const tasks = makeList({
			id: "Tasks",
			name: "Tasks",
			source: { kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] },
		});
		const result = collectionsForEntity("a", [tasks], DB);
		expect(result).toEqual([{ list: tasks, kind: MembershipKind.Source }]);
	});

	it("tags Include when source misses but include adds the entity", () => {
		const list = makeList({
			id: "L",
			name: "Manual",
			source: null,
			members: {
				include: [{ entityId: "a", addedAt: NOW, by: "user" }],
				exclude: [],
			},
		});
		expect(membershipKindFor("a", list, DB)).toBe(MembershipKind.Include);
	});

	it("tags Excluded when source matches but exclude removes the entity", () => {
		const list = makeList({
			id: "L",
			name: "Tasks (minus a)",
			source: { kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] },
			members: {
				include: [],
				exclude: [{ entityId: "a", removedAt: NOW, by: "user" }],
			},
		});
		expect(membershipKindFor("a", list, DB)).toBe(MembershipKind.Excluded);
	});

	it("returns null when source matches AND exclude AND include — exclude wins, kind reflects effective state", () => {
		// Pathological state: include + exclude on the same id. `effectiveMembers`
		// removes from exclude last, so the entity is not effective; source also
		// matches, so the badge reflects Excluded (the user's intent visible
		// in the override).
		const list = makeList({
			id: "L",
			name: "Conflicted",
			source: { kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] },
			members: {
				include: [{ entityId: "a", addedAt: NOW, by: "user" }],
				exclude: [{ entityId: "a", removedAt: NOW, by: "user" }],
			},
		});
		expect(membershipKindFor("a", list, DB)).toBe(MembershipKind.Excluded);
	});

	it("returns null when only include+exclude both fire and source misses", () => {
		// `c` is a Note, source matches Tasks — but for THIS list the source
		// is null. include adds, exclude removes → not effective, no source
		// match → no relationship to report (null).
		const list = makeList({
			id: "L",
			name: "Self-cancelling",
			source: null,
			members: {
				include: [{ entityId: "c", addedAt: NOW, by: "user" }],
				exclude: [{ entityId: "c", removedAt: NOW, by: "user" }],
			},
		});
		expect(membershipKindFor("c", list, DB)).toBeNull();
	});

	it("preserves input list order", () => {
		const L1 = makeList({
			id: "L1",
			name: "Zebra",
			source: { kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] },
		});
		const L2 = makeList({
			id: "L2",
			name: "Alpha",
			source: { kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] },
		});
		const result = collectionsForEntity("a", [L1, L2], DB);
		expect(result.map((r) => r.list.id)).toEqual(["L1", "L2"]);
	});

	it("skips soft-deleted entities consistently with evaluateSource", () => {
		const dbWithDeleted: InMemoryEntities = {
			...DB,
			entities: [{ ...entity("z", "io.test/Task/v1"), deletedAt: 1 }],
		};
		const list = makeList({
			id: "L",
			name: "Tasks",
			source: { kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] },
		});
		expect(membershipKindFor("z", list, dbWithDeleted)).toBeNull();
	});
});

describe("sourceMatches", () => {
	it("reports source-only membership ignoring overrides", () => {
		const list = makeList({
			id: "L",
			name: "Tasks",
			source: { kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] },
			members: {
				include: [],
				// exclude is irrelevant to sourceMatches — that's the point
				exclude: [{ entityId: "a", removedAt: NOW, by: "user" }],
			},
		});
		expect(sourceMatches("a", list, DB)).toBe(true);
		expect(sourceMatches("c", list, DB)).toBe(false);
	});

	it("returns false for null sources (manual-only lists)", () => {
		const list = makeList({ id: "L", name: "Manual", source: null });
		expect(sourceMatches("a", list, DB)).toBe(false);
	});
});

describe("pickerCandidatesForEntity", () => {
	const tasksByType = makeList({
		id: "Tasks",
		name: "Tasks",
		source: { kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] },
	});

	const manual = makeList({
		id: "Manual",
		name: "Manual",
		source: null,
	});

	const vaultDerived = makeList({
		id: "list_vault_Task",
		name: "All Tasks",
		source: { kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] },
	});

	const isVault = (id: string): boolean => id.startsWith("list_vault_");

	it("excludes vault-derived lists from the picker", () => {
		const candidates = pickerCandidatesForEntity("a", [vaultDerived, manual], DB, isVault);
		expect(candidates.map((l) => l.id)).toEqual(["Manual"]);
	});

	it("excludes lists already containing the entity via Source", () => {
		// `a` is already in `tasksByType` (source matches). Picker hides it.
		const candidates = pickerCandidatesForEntity("a", [tasksByType, manual], DB, isVault);
		expect(candidates.map((l) => l.id)).toEqual(["Manual"]);
	});

	it("excludes lists already containing the entity via Include", () => {
		const withInclude = makeList({
			id: "Manual",
			name: "Manual",
			source: null,
			members: { include: [{ entityId: "a", addedAt: NOW, by: "user" }], exclude: [] },
		});
		const candidates = pickerCandidatesForEntity("a", [withInclude], DB, isVault);
		expect(candidates).toEqual([]);
	});

	it("KEEPS lists where the entity is Excluded (one-click un-exclude)", () => {
		const withExclude = makeList({
			id: "Tasks",
			name: "Tasks",
			source: { kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] },
			members: { include: [], exclude: [{ entityId: "a", removedAt: NOW, by: "user" }] },
		});
		const candidates = pickerCandidatesForEntity("a", [withExclude], DB, isVault);
		expect(candidates.map((l) => l.id)).toEqual(["Tasks"]);
	});

	it("preserves input list order", () => {
		const candidates = pickerCandidatesForEntity(
			"c", // a Note — doesn't match the Task source; both lists offer
			[tasksByType, manual],
			DB,
			isVault,
		);
		expect(candidates.map((l) => l.id)).toEqual(["Tasks", "Manual"]);
	});
});

describe("round-trip with addToList / removeFromList", () => {
	const tasks = makeList({
		id: "Tasks",
		name: "Tasks",
		source: { kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] },
	});

	it("addToList for a source-miss entity → next read reports Include", () => {
		const matchesSource = sourceMatches("c", tasks, DB);
		const { members, outcome } = addToList(tasks.members, "c", {
			matchesSource,
			by: "user",
			now: NOW,
		});
		expect(outcome).toBe("included");
		const next = { ...tasks, members };
		expect(membershipKindFor("c", next, DB)).toBe(MembershipKind.Include);
	});

	it("removeFromList for a source-match entity → next read reports Excluded", () => {
		const matchesSource = sourceMatches("a", tasks, DB);
		const { members, outcome } = removeFromList(tasks.members, "a", {
			matchesSource,
			by: "user",
			now: NOW,
		});
		expect(outcome).toBe("excluded");
		const next = { ...tasks, members };
		expect(membershipKindFor("a", next, DB)).toBe(MembershipKind.Excluded);
	});

	it("addToList on an excluded source-match entity → un-excludes back to Source", () => {
		const start: List = {
			...tasks,
			members: {
				include: [],
				exclude: [{ entityId: "a", removedAt: NOW, by: "user" }],
			},
		};
		expect(membershipKindFor("a", start, DB)).toBe(MembershipKind.Excluded);

		const matchesSource = sourceMatches("a", start, DB);
		const { members, outcome } = addToList(start.members, "a", {
			matchesSource,
			by: "user",
			now: NOW,
		});
		expect(outcome).toBe("un-excluded");
		const next = { ...start, members };
		expect(membershipKindFor("a", next, DB)).toBe(MembershipKind.Source);
	});

	it("pickerCandidatesForEntity offers excluded lists (so click=un-exclude works)", () => {
		const start: List = {
			...tasks,
			members: {
				include: [],
				exclude: [{ entityId: "a", removedAt: NOW, by: "user" }],
			},
		};
		// `a` is excluded from `tasks`; picker should include `tasks` so the
		// user can "Add to collection" → un-exclude in one click.
		const lists = [start];
		const candidates = pickerCandidatesForEntity("a", lists, DB, () => false);
		expect(candidates.map((l) => l.id)).toEqual(["Tasks"]);
	});

	it("removeFromList on an included source-miss entity → un-includes to null", () => {
		const start: List = {
			...tasks,
			members: {
				include: [{ entityId: "c", addedAt: NOW, by: "user" }],
				exclude: [],
			},
		};
		expect(membershipKindFor("c", start, DB)).toBe(MembershipKind.Include);

		const matchesSource = sourceMatches("c", start, DB);
		const { members, outcome } = removeFromList(start.members, "c", {
			matchesSource,
			by: "user",
			now: NOW,
		});
		expect(outcome).toBe("un-included");
		const next = { ...start, members };
		expect(membershipKindFor("c", next, DB)).toBeNull();
	});
});
