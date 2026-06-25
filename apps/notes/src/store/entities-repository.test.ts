/**
 * 9.3.5.N-notes.3 — the entities-service-backed NotesRepository. Mirrors
 * the Tasks entities-repo test: id-keyed get-then-create-or-update,
 * codec round-trip through the property bag, delete delegation,
 * query-failure degrade, and the idempotent kv→shared bridge.
 */

import { describe, expect, it, vi } from "vitest";
import { NOTE_TYPE, createEntitiesRepository, foreignEntityToNote } from "./entities-repository";
import type { StoredNote } from "./note";
import type { EntitiesService, EntityRecord } from "./runtime";

class MockEntities implements EntitiesService {
	private map = new Map<string, EntityRecord>();
	calls: Array<{ op: string; id?: string }> = [];

	get = vi.fn(async (id: string) => {
		this.calls.push({ op: "get", id });
		return this.map.get(id) ?? null;
	});
	query = vi.fn(async (q: { type?: string | string[] }) => {
		this.calls.push({ op: "query" });
		const types = q.type === undefined ? null : Array.isArray(q.type) ? q.type : [q.type];
		return [...this.map.values()].filter((e) => !types || types.includes(e.type));
	});
	create = vi.fn(async (type: string, properties: Record<string, unknown>, id?: string) => {
		const eid = id ?? `ent_${this.map.size + 1}`;
		if (this.map.has(eid)) throw new Error(`create: ${eid} exists`);
		this.calls.push({ op: "create", id: eid });
		const rec: EntityRecord = { id: eid, type, properties, createdAt: 1, updatedAt: 1 };
		this.map.set(eid, rec);
		return rec;
	});
	update = vi.fn(async (id: string, patch: Record<string, unknown>) => {
		this.calls.push({ op: "update", id });
		const ex = this.map.get(id);
		if (!ex) throw new Error(`update: ${id} missing`);
		const next = { ...ex, properties: { ...ex.properties, ...patch }, updatedAt: 2 };
		this.map.set(id, next);
		return next;
	});
	delete = vi.fn(async (id: string) => {
		this.calls.push({ op: "delete", id });
		this.map.delete(id);
	});
	loadDoc = vi.fn(async (_id: string) => ({ snapshotB64: "", truncatedTail: false }));
	applyDoc = vi.fn(async (_id: string, _updateB64: string) => undefined);
	closeDoc = vi.fn(async (_id: string) => undefined);

	seed(rec: EntityRecord): void {
		this.map.set(rec.id, rec);
	}
}

const note = (over: Partial<StoredNote> = {}): StoredNote => ({
	id: "n_1",
	title: "Hello",
	icon: null,
	cover: null,
	body: "",
	values: {},
	createdAt: 100,
	updatedAt: 200,
	...over,
});

describe("createEntitiesRepository (Notes)", () => {
	it("save creates a new note keyed on its stable id, type-tagged", async () => {
		const e = new MockEntities();
		await createEntitiesRepository(e).save(note({ id: "n_x", title: "T" }));
		expect(e.create).toHaveBeenCalledWith(
			NOTE_TYPE,
			expect.objectContaining({ title: "T", createdAt: 100, updatedAt: 200 }),
			"n_x",
		);
		// id is the entity id, never duplicated into the property bag.
		expect((e.create.mock.calls[0]?.[1] as Record<string, unknown>).id).toBeUndefined();
	});

	it("save updates in place when the id already exists (no duplicate create)", async () => {
		const e = new MockEntities();
		const repo = createEntitiesRepository(e);
		await repo.save(note({ id: "n_x", title: "first" }));
		await repo.save(note({ id: "n_x", title: "second" }));
		expect(e.create).toHaveBeenCalledTimes(1);
		expect(e.update).toHaveBeenCalledTimes(1);
		const back = await repo.listAll();
		expect(back.get("n_x")?.title).toBe("second");
	});

	it("falls back to update when the id collides though get returned nothing", async () => {
		// A prior session migrated the row, or it lives under a type/owner
		// the Notes view can't see (ids are keyed globally). get → null,
		// but create rejects with "already exists" — the bridge must
		// upsert, not flood the console once per pre-migrated row.
		const e = new MockEntities();
		e.seed({ id: "n_x", type: NOTE_TYPE, properties: { title: "old" }, createdAt: 1, updatedAt: 1 });
		e.get.mockResolvedValueOnce(null);
		e.create.mockRejectedValueOnce(new Error("entities.create: n_x already exists"));
		await expect(
			createEntitiesRepository(e).save(note({ id: "n_x", title: "new" })),
		).resolves.toBeUndefined();
		expect(e.update).toHaveBeenCalledWith("n_x", expect.objectContaining({ title: "new" }));
	});

	it("listAll round-trips through the codec (property bag → StoredNote)", async () => {
		const e = new MockEntities();
		e.seed({
			id: "n_seed",
			type: NOTE_TYPE,
			properties: { title: "Seeded", icon: "🔥", body: "", values: {}, createdAt: 5, updatedAt: 6 },
			createdAt: 1,
			updatedAt: 1,
		});
		const map = await createEntitiesRepository(e).listAll();
		expect(map.get("n_seed")).toMatchObject({
			id: "n_seed",
			title: "Seeded",
			icon: { kind: "emoji", value: "🔥" },
			createdAt: 5,
		});
	});

	it("listAll degrades to an empty map on a query failure", async () => {
		const e = new MockEntities();
		e.query.mockRejectedValueOnce(new Error("db down"));
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		expect((await createEntitiesRepository(e).listAll()).size).toBe(0);
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});

	it("remove delegates to entities.delete", async () => {
		const e = new MockEntities();
		const repo = createEntitiesRepository(e);
		await repo.save(note({ id: "n_del" }));
		await repo.remove("n_del");
		expect(e.delete).toHaveBeenCalledWith("n_del");
		expect((await repo.listAll()).has("n_del")).toBe(false);
	});

	it("strips Notes-internal `bodyLegacy` from the shared entity property bag", async () => {
		// `bodyLegacy` is a Notes-side rollback target produced by the
		// codec when an on-disk row carried a legacy SerializedEditorState
		// shape; the migration uses it as the planting source. Persisting
		// it BACK into the shared entity property bag created a dual-body
		// state on disk (`body` from the kv projection + `bodyLegacy`
		// from Notes' save), and every subsequent read fired the codec's
		// "carries both body and bodyLegacy" warning (1980 hits in one
		// session before this fix). The shared bag must NOT carry it.
		const e = new MockEntities();
		const legacy = {
			root: { type: "root", children: [] },
		} as unknown as Record<string, unknown>;
		await createEntitiesRepository(e).save(
			note({
				id: "n_legacy",
				title: "Has rollback",
				body: "snippet",
				// biome-ignore lint/suspicious/noExplicitAny: test wedge for the legacy field
				bodyLegacy: legacy as any,
			}),
		);
		const props = e.create.mock.calls[0]?.[1] as Record<string, unknown>;
		expect(props.title).toBe("Has rollback");
		expect(props.body).toBe("snippet");
		expect("bodyLegacy" in props).toBe(false);
	});

	it("patchBody calls entities.update with only the body field (server-side merge preserves other props)", async () => {
		const e = new MockEntities();
		e.seed({
			id: "n_p",
			type: NOTE_TYPE,
			properties: {
				title: "Original",
				icon: null,
				body: "old snippet",
				values: { keep: "me" },
				updatedAt: 5000,
				createdAt: 1,
			},
			createdAt: 1,
			updatedAt: 5000,
		});
		await createEntitiesRepository(e).patchBody("n_p", "new snippet from migration");
		expect(e.update).toHaveBeenCalledWith("n_p", { body: "new snippet from migration" });
		// MockEntities does an actual ...patch merge — confirm the
		// other property-bag fields are preserved end-to-end.
		const after = await e.get("n_p");
		expect(after?.properties).toMatchObject({
			title: "Original",
			values: { keep: "me" },
			updatedAt: 5000,
			body: "new snippet from migration",
		});
	});

	it("patchBody swallows an `Invalid` error (the row was removed mid-flight — best-effort)", async () => {
		const e = new MockEntities();
		// no seed → entities.update throws "update: <id> missing"
		const named = (name: string, message: string): Error => {
			const err = new Error(message);
			err.name = name;
			return err;
		};
		e.update.mockRejectedValueOnce(named("Invalid", "entities.update: gone"));
		await expect(
			createEntitiesRepository(e).patchBody("n_gone", "anything"),
		).resolves.toBeUndefined();
	});

	it("save/remove throw on entities failure (hook surfaces it)", async () => {
		const e = new MockEntities();
		e.get.mockRejectedValueOnce(new Error("boom"));
		await expect(createEntitiesRepository(e).save(note())).rejects.toThrow("boom");
		e.delete.mockRejectedValueOnce(new Error("locked"));
		await expect(createEntitiesRepository(e).remove("x")).rejects.toThrow("locked");
	});
});

describe("foreignEntityToNote (universal object editor)", () => {
	it("titles from name/label and seeds an empty body when there's none", () => {
		const note = foreignEntityToNote({
			id: "ent_p1",
			type: "brainstorm/Person/v1",
			properties: { name: "Ada Lovelace", email: "ada@x.io" },
			createdAt: 100,
			updatedAt: 200,
		});
		expect(note.id).toBe("ent_p1");
		expect(note.title).toBe("Ada Lovelace");
		// Domain timestamps come from the entity when the prop bag has none.
		expect(note.createdAt).toBe(100);
		expect(note.updatedAt).toBe(200);
	});

	it("prefers an explicit title prop and routes a legacy editor-state body to bodyLegacy", () => {
		const body = {
			root: { children: [], direction: null, format: "", indent: 0, type: "root", version: 1 },
		};
		const note = foreignEntityToNote({
			id: "ent_x",
			type: "brainstorm/Task/v1",
			properties: { title: "Ship it", name: "ignored", body },
			createdAt: 1,
			updatedAt: 2,
		});
		expect(note.title).toBe("Ship it");
		// 9.3.5.N4 — post-narrowing, `body` is the denormalised snippet
		// string (empty until the migration walks the planted Y.Doc); a
		// pre-N2 SerializedEditorState payload rides on `bodyLegacy` so
		// the migration can plant it and the user can hand-roll back.
		expect(note.body).toBe("");
		expect(typeof note.bodyLegacy).toBe("object");
		expect((note.bodyLegacy as { root?: unknown }).root).toBeDefined();
	});

	it("falls back to an empty title for an unnamed object (never throws)", () => {
		const note = foreignEntityToNote({
			id: "ent_y",
			type: "x/Y/v1",
			properties: {},
			createdAt: 5,
			updatedAt: 6,
		});
		expect(note.id).toBe("ent_y");
		expect(note.title).toBe("");
	});
});
