/**
 * 9.3.5.N-notes keystone — the pure note→entity/edge codec. Locks the
 * row + link shape so the kv aggregator (today) and the future
 * entities-service-backed Notes repo derive identical output. Parity
 * with the live aggregator is asserted separately in
 * `vault-entities-service.test.ts` (those 34 tests stayed green after
 * `aggregateNotes` was refactored to delegate here).
 */

import { describe, expect, it } from "vitest";
import { NoteReferenceKind } from "./extract-note-references";
import {
	NOTES_APP_ID,
	NOTE_MENTION_LINK_TYPE,
	NOTE_REFERENCE_LINK_TYPE,
	NOTE_TYPE,
	noteLinkId,
	noteToProjection,
} from "./note-entities-codec";

const mentionBody = (entityId: string, entityType = "io.brainstorm.notes/Note/v1") => ({
	root: {
		children: [
			{
				type: "paragraph",
				children: [{ type: "mention", entityId, entityType }],
			},
		],
	},
});

describe("noteToProjection", () => {
	it("projects the canonical Note/v1 row with title mirrored into name+title", () => {
		const { entity } = noteToProjection(
			{ id: "n_1", title: "Hello", icon: null, createdAt: 100, updatedAt: 200 },
			"fallback",
		);
		expect(entity).toEqual({
			id: "n_1",
			type: NOTE_TYPE,
			properties: {
				name: "Hello",
				title: "Hello",
				icon: null,
				body: null,
				aboutEntityId: null,
			},
			createdAt: 100,
			updatedAt: 200,
			deletedAt: null,
			ownerAppId: NOTES_APP_ID,
		});
	});

	it("uses the fallback id only when the blob has no string id", () => {
		expect(noteToProjection({ title: "x" }, "from-key").entity.id).toBe("from-key");
		expect(noteToProjection({ id: "", title: "x" }, "from-key").entity.id).toBe("from-key");
		expect(noteToProjection({ id: "real" }, "from-key").entity.id).toBe("real");
	});

	it("carries the note body through to properties (string and rich-text)", () => {
		expect(
			noteToProjection({ id: "n", title: "T", body: "hello world" }, "n").entity.properties.body,
		).toBe("hello world");
		const rich = { root: { children: [] } };
		expect(noteToProjection({ id: "n", body: rich }, "n").entity.properties.body).toEqual(rich);
		// No body → null, never undefined (stable shape for consumers).
		expect(noteToProjection({ id: "n" }, "n").entity.properties.body).toBeNull();
	});

	it("carries seeder-written `aboutEntityId` onto properties for Note/about edges (SH-37)", () => {
		const { entity } = noteToProjection(
			{ id: "iteration-9-13-5", title: "9.13.5", aboutEntityId: "iter-9-13-5" },
			"iteration-9-13-5",
		);
		expect(entity.properties.aboutEntityId).toBe("iter-9-13-5");

		// Non-string / empty → null so the derive-rule never emits a junk edge.
		expect(
			noteToProjection({ id: "n", aboutEntityId: 42 }, "n").entity.properties.aboutEntityId,
		).toBeNull();
		expect(
			noteToProjection({ id: "n", aboutEntityId: "" }, "n").entity.properties.aboutEntityId,
		).toBeNull();
		expect(noteToProjection({ id: "n" }, "n").entity.properties.aboutEntityId).toBeNull();
	});

	it("defaults timestamps deterministically (updatedAt falls back to createdAt)", () => {
		const { entity } = noteToProjection({ id: "n", createdAt: 42 }, "n", 999);
		expect(entity.createdAt).toBe(42);
		expect(entity.updatedAt).toBe(42);
		const blank = noteToProjection({ id: "n" }, "n", 999).entity;
		expect(blank.createdAt).toBe(999);
		expect(blank.updatedAt).toBe(999);
	});

	it("derives a mention edge with the mention link type + stable id", () => {
		const { links } = noteToProjection({ id: "src", body: mentionBody("dst"), updatedAt: 7 }, "src");
		expect(links).toEqual([
			{
				id: noteLinkId("src", NoteReferenceKind.Mention, "dst"),
				sourceEntityId: "src",
				destEntityId: "dst",
				linkType: NOTE_MENTION_LINK_TYPE,
				createdAt: 7,
				deletedAt: null,
			},
		]);
	});

	it("derives a link edge from a brainstorm://entity URL", () => {
		const body = {
			root: {
				children: [
					{
						type: "paragraph",
						children: [{ type: "link", url: "brainstorm://entity/dst-2", children: [] }],
					},
				],
			},
		};
		const { links } = noteToProjection({ id: "src", body, updatedAt: 9 }, "src");
		expect(links).toHaveLength(1);
		expect(links[0]?.linkType).toBe(NOTE_REFERENCE_LINK_TYPE);
		expect(links[0]?.destEntityId).toBe("dst-2");
		expect(links[0]?.id).toBe(noteLinkId("src", NoteReferenceKind.Link, "dst-2"));
	});

	it("tolerates legacy string + missing bodies (no edges, no throw)", () => {
		expect(noteToProjection({ id: "n", body: "plain legacy text" }, "n").links).toEqual([]);
		expect(noteToProjection({ id: "n" }, "n").links).toEqual([]);
		expect(noteToProjection({}, "k").entity.properties.title).toBe("");
	});

	// F-067: the denormalised `body` is a plain-text snippet with no rich nodes,
	// so edges must come from the persisted `bodyRefs` the Notes autosave writes.
	it("F-067: derives edges from persisted bodyRefs even when body is a flat snippet", () => {
		const { links } = noteToProjection(
			{
				id: "src",
				body: "Distribution moats at seed — a flat snippet, no rich nodes",
				bodyRefs: [{ entityId: "dst", entityType: "Object/v1", kind: NoteReferenceKind.Mention }],
				updatedAt: 7,
			},
			"src",
		);
		expect(links).toEqual([
			{
				id: noteLinkId("src", NoteReferenceKind.Mention, "dst"),
				sourceEntityId: "src",
				destEntityId: "dst",
				linkType: NOTE_MENTION_LINK_TYPE,
				createdAt: 7,
				deletedAt: null,
			},
		]);
	});

	it("F-067: bodyRefs is authoritative over the body walk when both are present", () => {
		const { links } = noteToProjection(
			{
				id: "src",
				body: mentionBody("from-body"),
				bodyRefs: [{ entityId: "from-refs", entityType: "", kind: NoteReferenceKind.Transclusion }],
			},
			"src",
		);
		expect(links).toHaveLength(1);
		expect(links[0]?.destEntityId).toBe("from-refs");
		expect(links[0]?.linkType).toBe(NOTE_REFERENCE_LINK_TYPE);
	});

	it("F-067: an explicit empty bodyRefs yields no edges (and does NOT fall back to body)", () => {
		const { links } = noteToProjection(
			{ id: "src", body: mentionBody("ignored"), bodyRefs: [] },
			"src",
		);
		expect(links).toEqual([]);
	});

	it("F-067: garbage bodyRefs falls back to walking the body", () => {
		const { links } = noteToProjection(
			{ id: "src", body: mentionBody("dst"), bodyRefs: "not-an-array", updatedAt: 1 },
			"src",
		);
		expect(links).toHaveLength(1);
		expect(links[0]?.destEntityId).toBe("dst");
	});

	it("dedupes repeated references the way the protocol walker does", () => {
		const body = {
			root: {
				children: [
					{ type: "mention", entityId: "dup", entityType: "t" },
					{ type: "mention", entityId: "dup", entityType: "t" },
				],
			},
		};
		expect(noteToProjection({ id: "s", body }, "s").links).toHaveLength(1);
	});
});
