/**
 * Pure-decision tests for `decideToggleMembership`. The host wrapper in
 * `app.ts` is one `.map()` + render call; the actual rule lives here.
 */

import { describe, expect, it } from "vitest";
import type { List } from "../types/list";
import { ListSourceKind } from "../types/list-source";
import type { EntityRow, InMemoryEntities } from "./in-memory-entities";
import { ToggleVerb, decideToggleMembership } from "./toggle-membership";

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
	entities: [entity("a", "io.test/Task/v1", { status: "Done" }), entity("c", "io.test/Note/v1")],
	links: [],
};

const NEVER_VAULT = () => false;
const ALWAYS_VAULT = () => true;

describe("decideToggleMembership", () => {
	it("returns skip:list-not-found for an unknown id", () => {
		const out = decideToggleMembership({
			listId: "missing",
			entityId: "a",
			add: true,
			lists: [],
			db: DB,
			isVaultDerived: NEVER_VAULT,
		});
		expect(out).toEqual({ kind: "skip", reason: "list-not-found" });
	});

	it("returns skip:vault-derived for read-only lists, even on add", () => {
		const lists = [makeList({ id: "vault_x", name: "All Tasks" })];
		const out = decideToggleMembership({
			listId: "vault_x",
			entityId: "a",
			add: true,
			lists,
			db: DB,
			isVaultDerived: ALWAYS_VAULT,
		});
		expect(out).toEqual({ kind: "skip", reason: "vault-derived" });
	});

	it("adds a source-miss entity → commit + ToggleVerb.Added + include grows by one", () => {
		const list = makeList({ id: "M", name: "Manual", source: null });
		const out = decideToggleMembership({
			listId: "M",
			entityId: "c",
			add: true,
			lists: [list],
			db: DB,
			isVaultDerived: NEVER_VAULT,
			now: NOW,
		});
		expect(out.kind).toBe("commit");
		if (out.kind !== "commit") return;
		expect(out.verb).toBe(ToggleVerb.Added);
		expect(out.next.members.include.map((m) => m.entityId)).toEqual(["c"]);
		expect(out.next.updatedAt).toBe(NOW);
	});

	it("removes a source-match entity → commit + ToggleVerb.Excluded + exclude grows by one", () => {
		const list = makeList({
			id: "T",
			name: "Tasks",
			source: { kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] },
		});
		const out = decideToggleMembership({
			listId: "T",
			entityId: "a",
			add: false,
			lists: [list],
			db: DB,
			isVaultDerived: NEVER_VAULT,
			now: NOW,
		});
		expect(out.kind).toBe("commit");
		if (out.kind !== "commit") return;
		expect(out.verb).toBe(ToggleVerb.Excluded);
		expect(out.next.members.exclude.map((m) => m.entityId)).toEqual(["a"]);
	});

	it("un-excludes a source-matched-but-excluded entity → commit + ToggleVerb.ReAdded + exclude shrinks", () => {
		const list = makeList({
			id: "T",
			name: "Tasks",
			source: { kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] },
			members: { include: [], exclude: [{ entityId: "a", removedAt: NOW, by: "user" }] },
		});
		const out = decideToggleMembership({
			listId: "T",
			entityId: "a",
			add: true,
			lists: [list],
			db: DB,
			isVaultDerived: NEVER_VAULT,
		});
		expect(out.kind).toBe("commit");
		if (out.kind !== "commit") return;
		expect(out.verb).toBe(ToggleVerb.ReAdded);
		expect(out.next.members.exclude).toEqual([]);
	});

	it("un-includes an explicit-included entity → commit + ToggleVerb.Removed + include shrinks", () => {
		const list = makeList({
			id: "M",
			name: "Manual",
			source: null,
			members: { include: [{ entityId: "c", addedAt: NOW, by: "user" }], exclude: [] },
		});
		const out = decideToggleMembership({
			listId: "M",
			entityId: "c",
			add: false,
			lists: [list],
			db: DB,
			isVaultDerived: NEVER_VAULT,
		});
		expect(out.kind).toBe("commit");
		if (out.kind !== "commit") return;
		expect(out.verb).toBe(ToggleVerb.Removed);
		expect(out.next.members.include).toEqual([]);
	});

	it("idempotent add (already in source) → skip:no-op", () => {
		const list = makeList({
			id: "T",
			name: "Tasks",
			source: { kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] },
		});
		const out = decideToggleMembership({
			listId: "T",
			entityId: "a",
			add: true,
			lists: [list],
			db: DB,
			isVaultDerived: NEVER_VAULT,
		});
		expect(out).toEqual({ kind: "skip", reason: "no-op" });
	});

	it("idempotent remove (never in source, never in include) → skip:no-op", () => {
		const list = makeList({
			id: "M",
			name: "Manual",
			source: null,
		});
		const out = decideToggleMembership({
			listId: "M",
			entityId: "c",
			add: false,
			lists: [list],
			db: DB,
			isVaultDerived: NEVER_VAULT,
		});
		expect(out).toEqual({ kind: "skip", reason: "no-op" });
	});

	it("preserves the rest of the List shape (icon, name, views, defaultViewId) on commit", () => {
		const list = makeList({
			id: "T",
			name: "Tasks",
			source: { kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] },
			views: ["view-1"],
			defaultViewId: "view-1",
		});
		const out = decideToggleMembership({
			listId: "T",
			entityId: "a",
			add: false,
			lists: [list],
			db: DB,
			isVaultDerived: NEVER_VAULT,
			now: NOW,
		});
		expect(out.kind).toBe("commit");
		if (out.kind !== "commit") return;
		expect(out.next.id).toBe("T");
		expect(out.next.name).toBe("Tasks");
		expect(out.next.views).toEqual(["view-1"]);
		expect(out.next.defaultViewId).toBe("view-1");
	});
});
