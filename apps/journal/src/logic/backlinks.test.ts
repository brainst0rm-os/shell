import { describe, expect, it } from "vitest";
import {
	JOURNAL_ENTRY_TYPE,
	NOTE_ENTITY_TYPE,
	type VaultEntity,
	type VaultLink,
	type VaultSnapshot,
} from "../runtime";
import { findBacklinks, findOutgoingLinks } from "./backlinks";

function note(over: Partial<VaultEntity> & { id: string; title?: string }): VaultEntity {
	return {
		id: over.id,
		type: over.type ?? NOTE_ENTITY_TYPE,
		properties: { title: over.title ?? `Note ${over.id}` },
		createdAt: over.createdAt ?? 1,
		updatedAt: over.updatedAt ?? 1,
		deletedAt: over.deletedAt ?? null,
		ownerAppId: over.ownerAppId ?? "io.brainstorm.notes",
	};
}

function link(source: string, dest: string, linkType = "io.brainstorm.notes/mention"): VaultLink {
	return {
		id: `lnk_${source}_${dest}`,
		sourceEntityId: source,
		destEntityId: dest,
		linkType,
		createdAt: 0,
		deletedAt: null,
	};
}

function snap(entities: VaultEntity[], links: VaultLink[]): VaultSnapshot {
	return { entities, links };
}

describe("findBacklinks", () => {
	it("returns empty when noteId is empty", () => {
		expect(findBacklinks(snap([], []), "")).toEqual([]);
	});

	it("returns notes whose body links to the target", () => {
		const s = snap(
			[note({ id: "target" }), note({ id: "src1" }), note({ id: "src2" })],
			[link("src1", "target"), link("src2", "target")],
		);
		const out = findBacklinks(s, "target");
		expect(out.map((b) => b.sourceNoteId).sort()).toEqual(["src1", "src2"]);
	});

	it("orders by source.updatedAt descending (freshest first)", () => {
		const s = snap(
			[
				note({ id: "target" }),
				note({ id: "old", updatedAt: 10 }),
				note({ id: "fresh", updatedAt: 1000 }),
			],
			[link("old", "target"), link("fresh", "target")],
		);
		expect(findBacklinks(s, "target").map((b) => b.sourceNoteId)).toEqual(["fresh", "old"]);
	});

	it("dedupes when the same source has multiple links to the target", () => {
		const s = snap(
			[note({ id: "target" }), note({ id: "src" })],
			[
				link("src", "target", "io.brainstorm.notes/mention"),
				link("src", "target", "io.brainstorm.notes/link"),
			],
		);
		expect(findBacklinks(s, "target")).toHaveLength(1);
	});

	it("filters self-references (a note linking to itself shouldn't backlink)", () => {
		const s = snap(
			[note({ id: "self" }), note({ id: "src" })],
			[link("self", "self"), link("src", "self")],
		);
		const out = findBacklinks(s, "self");
		expect(out.map((b) => b.sourceNoteId)).toEqual(["src"]);
	});

	it("accepts a journal entry as a backlink source and carries its real type", () => {
		const s = snap(
			[
				note({ id: "target" }),
				note({ id: "n1" }),
				note({ id: "journal-2026-06-01", type: JOURNAL_ENTRY_TYPE, title: "2026-06-01" }),
			],
			[link("n1", "target"), link("journal-2026-06-01", "target")],
		);
		const out = findBacklinks(s, "target");
		expect(out.map((b) => b.sourceNoteId).sort()).toEqual(["journal-2026-06-01", "n1"]);
		const byId = new Map(out.map((b) => [b.sourceNoteId, b] as const));
		expect(byId.get("n1")?.sourceType).toBe(NOTE_ENTITY_TYPE);
		expect(byId.get("journal-2026-06-01")?.sourceType).toBe(JOURNAL_ENTRY_TYPE);
	});

	it("ignores links from non-Note entities (tasks, projects)", () => {
		const s = snap(
			[
				note({ id: "target" }),
				note({ id: "n1" }),
				{
					id: "t1",
					type: "brainstorm/Task/v1",
					properties: {},
					createdAt: 0,
					updatedAt: 0,
					deletedAt: null,
					ownerAppId: "io.brainstorm.tasks",
				},
			],
			[link("n1", "target"), link("t1", "target")],
		);
		expect(findBacklinks(s, "target").map((b) => b.sourceNoteId)).toEqual(["n1"]);
	});

	it("filters soft-deleted source notes", () => {
		const s = snap(
			[note({ id: "target" }), note({ id: "live" }), note({ id: "gone", deletedAt: 100 })],
			[link("live", "target"), link("gone", "target")],
		);
		expect(findBacklinks(s, "target").map((b) => b.sourceNoteId)).toEqual(["live"]);
	});

	it("falls back to '(untitled)' when source has no title or name", () => {
		const s = snap(
			[
				note({ id: "target" }),
				{
					id: "blank",
					type: NOTE_ENTITY_TYPE,
					properties: {},
					createdAt: 0,
					updatedAt: 0,
					deletedAt: null,
					ownerAppId: "io.brainstorm.notes",
				},
			],
			[link("blank", "target")],
		);
		expect(findBacklinks(s, "target")[0]?.title).toBe("(untitled)");
	});

	it("preserves linkType from the first encountered link", () => {
		const s = snap(
			[note({ id: "target" }), note({ id: "src" })],
			[link("src", "target", "io.brainstorm.notes/link")],
		);
		expect(findBacklinks(s, "target")[0]?.linkType).toBe("io.brainstorm.notes/link");
	});
});

describe("findOutgoingLinks", () => {
	it("returns entries this note references (dest side), newest first", () => {
		const s = snap(
			[
				note({ id: "src", type: JOURNAL_ENTRY_TYPE }),
				note({ id: "a", updatedAt: 10 }),
				note({ id: "b", updatedAt: 20 }),
			],
			[link("src", "a"), link("src", "b")],
		);
		const out = findOutgoingLinks(s, "src");
		expect(out.map((l) => l.destNoteId)).toEqual(["b", "a"]);
		expect(out[0]?.destType).toBe(NOTE_ENTITY_TYPE);
	});

	it("ignores incoming links, self-links, and soft-deleted targets", () => {
		const s = snap(
			[
				note({ id: "src", type: JOURNAL_ENTRY_TYPE }),
				note({ id: "gone", deletedAt: 5 }),
				note({ id: "other" }),
			],
			[
				link("other", "src"), // incoming, not outgoing
				link("src", "src"), // self
				link("src", "gone"), // deleted target
			],
		);
		expect(findOutgoingLinks(s, "src")).toEqual([]);
	});

	it("dedupes multiple links to the same target", () => {
		const s = snap(
			[note({ id: "src", type: JOURNAL_ENTRY_TYPE }), note({ id: "a" })],
			[link("src", "a", "io.brainstorm.notes/mention"), link("src", "a", "io.brainstorm.notes/link")],
		);
		expect(findOutgoingLinks(s, "src")).toHaveLength(1);
	});
});
