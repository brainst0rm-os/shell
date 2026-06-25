import { describe, expect, it, vi } from "vitest";
import type { Event } from "../types/event";
import { EVENT_TYPE, createEntitiesRepository } from "./entities-repository";
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

const makeEvent = (over: Partial<Event> = {}): Event => ({
	id: "ev1",
	title: "Standup",
	icon: null,
	start: 1000,
	end: 2000,
	allDay: false,
	location: null,
	recurrence: null,
	statusKey: null,
	colorHint: null,
	reminders: [],
	attendees: [],
	timeZone: null,
	createdAt: 100,
	updatedAt: 100,
	...over,
});

describe("createEntitiesRepository (calendar)", () => {
	it("save creates with the caller id when absent, updates when present", async () => {
		const e = new MockEntities();
		const repo = createEntitiesRepository(e);

		await repo.save(makeEvent({ id: "ev-a", title: "A" }));
		expect(e.create).toHaveBeenCalledWith(EVENT_TYPE, expect.any(Object), "ev-a");

		await repo.save(makeEvent({ id: "ev-a", title: "A renamed", end: 3000 }));
		expect(e.update).toHaveBeenCalledWith(
			"ev-a",
			expect.objectContaining({ title: "A renamed", end: 3000 }),
		);
		expect(e.create).toHaveBeenCalledTimes(1);
	});

	it("listAll maps Event entities back through the codec (domain ts preserved)", async () => {
		const e = new MockEntities();
		const repo = createEntitiesRepository(e);
		await repo.save(makeEvent({ id: "ev1", start: 42, end: 99, createdAt: 7 }));
		const all = await repo.listAll();
		expect(all).toHaveLength(1);
		expect(all[0]).toMatchObject({ id: "ev1", start: 42, end: 99, createdAt: 7 });
	});

	it("remove delegates to entities.delete", async () => {
		const e = new MockEntities();
		const repo = createEntitiesRepository(e);
		await repo.save(makeEvent({ id: "ev9" }));
		await repo.remove("ev9");
		expect(e.delete).toHaveBeenCalledWith("ev9");
	});

	it("listAll degrades to empty on a query failure", async () => {
		const e = new MockEntities();
		e.query.mockRejectedValueOnce(new Error("db locked"));
		expect(await createEntitiesRepository(e).listAll()).toEqual([]);
	});
});
