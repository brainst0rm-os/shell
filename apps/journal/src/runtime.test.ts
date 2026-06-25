import { describe, expect, it } from "vitest";
import {
	JOURNAL_ENTRY_TYPE,
	type VaultEntity,
	type VaultSnapshot,
	notesFromSnapshot,
	vaultEntityToNoteLike,
} from "./runtime";

function makeEntity(over: Partial<VaultEntity> = {}): VaultEntity {
	return {
		id: "e1",
		type: JOURNAL_ENTRY_TYPE,
		properties: { title: "2026-05-14", name: "2026-05-14" },
		createdAt: 0,
		updatedAt: 0,
		deletedAt: null,
		ownerAppId: "io.brainstorm.journal",
		...over,
	};
}

describe("vaultEntityToNoteLike", () => {
	it("prefers properties.title when present", () => {
		const out = vaultEntityToNoteLike(
			makeEntity({ properties: { title: "Hello", name: "fallback" } }),
		);
		expect(out.title).toBe("Hello");
		expect(out.id).toBe("e1");
	});

	it("falls back to properties.name when title is missing", () => {
		const out = vaultEntityToNoteLike(makeEntity({ properties: { name: "Just a name" } }));
		expect(out.title).toBe("Just a name");
	});

	it("returns empty title when both title and name are absent", () => {
		const out = vaultEntityToNoteLike(makeEntity({ properties: { icon: null } }));
		expect(out.title).toBe("");
	});

	it("passes body through when present", () => {
		const out = vaultEntityToNoteLike(
			makeEntity({ properties: { title: "T", body: "plain body text" } }),
		);
		expect(out.body).toBe("plain body text");
	});

	it("omits body entirely when properties.body is absent", () => {
		const out = vaultEntityToNoteLike(makeEntity({ properties: { title: "T" } }));
		expect(out.body).toBeUndefined();
	});
});

describe("notesFromSnapshot", () => {
	function snap(entities: VaultEntity[]): VaultSnapshot {
		return { entities, links: [] };
	}

	it("filters to journal-entry entities only", () => {
		const out = notesFromSnapshot(
			snap([
				makeEntity({ id: "n1" }),
				makeEntity({ id: "t1", type: "brainstorm/Task/v1" }),
				makeEntity({ id: "x1", type: "io.brainstorm.notes/Note/v1" }),
				makeEntity({ id: "n2" }),
			]),
		);
		expect(out.map((n) => n.id)).toEqual(["n1", "n2"]);
	});

	it("drops soft-deleted entities", () => {
		const out = notesFromSnapshot(
			snap([makeEntity({ id: "n1" }), makeEntity({ id: "n2", deletedAt: 1700000000000 })]),
		);
		expect(out.map((n) => n.id)).toEqual(["n1"]);
	});

	it("returns an empty list when the snapshot has no notes", () => {
		expect(notesFromSnapshot(snap([]))).toEqual([]);
		expect(notesFromSnapshot(snap([makeEntity({ type: "brainstorm/Task/v1" })]))).toEqual([]);
	});
});
