import { describe, expect, it, vi } from "vitest";
import { BOOKMARK_ENTITY_TYPE, type Bookmark } from "../types/bookmark";
import { createEntitiesRepository } from "./entities-repository";
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
}

const makeBookmark = (over: Partial<Bookmark> = {}): Bookmark => ({
	id: "bm1",
	url: "https://example.com/",
	title: "Example",
	faviconUrl: null,
	coverImageUrl: null,
	tags: ["read-later"],
	savedAt: 100,
	readAt: null,
	archivedAt: null,
	colorHint: null,
	createdAt: 100,
	updatedAt: 100,
	...over,
});

describe("createEntitiesRepository (bookmarks)", () => {
	it("save creates with the caller id when absent, updates when present", async () => {
		const e = new MockEntities();
		const repo = createEntitiesRepository(e);

		await repo.save(makeBookmark({ id: "bm-a", title: "A" }));
		expect(e.create).toHaveBeenCalledWith(BOOKMARK_ENTITY_TYPE, expect.any(Object), "bm-a");

		await repo.save(makeBookmark({ id: "bm-a", title: "A renamed", readAt: 5 }));
		expect(e.update).toHaveBeenCalledWith(
			"bm-a",
			expect.objectContaining({ title: "A renamed", readAt: 5 }),
		);
		expect(e.create).toHaveBeenCalledTimes(1);
	});

	it("listAll maps Bookmark entities back through the codec (domain ts preserved)", async () => {
		const e = new MockEntities();
		const repo = createEntitiesRepository(e);
		await repo.save(makeBookmark({ id: "bm1", tags: ["a", "b"], savedAt: 42, createdAt: 7 }));
		const all = await repo.listAll();
		expect(all).toHaveLength(1);
		expect(all[0]).toMatchObject({
			id: "bm1",
			tags: ["a", "b"],
			savedAt: 42,
			createdAt: 7,
		});
	});

	it("listAll stamps the store-level revision; save never persists it", async () => {
		const e = new MockEntities();
		const repo = createEntitiesRepository(e);
		await repo.save(makeBookmark({ id: "bm1" }));
		const [first] = await repo.listAll();
		expect(first?.rev).toBe(1); // MockEntities stamps create at updatedAt=1

		await repo.save({ ...(first as Bookmark), title: "renamed" });
		const patch = e.update.mock.calls[0]?.[1] as Record<string, unknown>;
		expect(patch).not.toHaveProperty("rev");
		const [second] = await repo.listAll();
		expect(second?.rev).toBe(2); // bumped by the store on update
	});

	it("remove delegates to entities.delete", async () => {
		const e = new MockEntities();
		const repo = createEntitiesRepository(e);
		await repo.save(makeBookmark({ id: "bm9" }));
		await repo.remove("bm9");
		expect(e.delete).toHaveBeenCalledWith("bm9");
	});

	it("listAll degrades to empty on a query failure", async () => {
		const e = new MockEntities();
		e.query.mockRejectedValueOnce(new Error("db locked"));
		expect(await createEntitiesRepository(e).listAll()).toEqual([]);
	});
});
