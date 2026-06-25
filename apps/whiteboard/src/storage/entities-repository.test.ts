import { describe, expect, it, vi } from "vitest";
import { ArrowHead, EdgePathKind, HandleSide, type WhiteboardEdge } from "../types/edge";
import { NodeKind, StickyColor } from "../types/node";
import type { Whiteboard } from "../types/whiteboard";
import { EDGE_TYPE, WHITEBOARD_TYPE, createEntitiesRepository } from "./entities-repository";
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

const makeWhiteboard = (over: Partial<Whiteboard> = {}): Whiteboard => ({
	id: "wb1",
	name: "Board",
	nodes: [
		{
			id: "n1",
			kind: NodeKind.Sticky,
			x: 0,
			y: 0,
			width: 120,
			height: 80,
			text: "hi",
			color: StickyColor.Yellow,
		},
	],
	createdAt: 100,
	updatedAt: 100,
	...over,
});

const makeEdge = (over: Partial<WhiteboardEdge> = {}): WhiteboardEdge => ({
	id: "e1",
	whiteboardId: "wb1",
	sourceNodeId: "n1",
	sourceHandle: HandleSide.Right,
	destNodeId: "n2",
	destHandle: HandleSide.Left,
	pathKind: EdgePathKind.Bezier,
	arrowHead: ArrowHead.Arrow,
	label: null,
	colorHint: null,
	createdAt: 100,
	updatedAt: 100,
	...over,
});

describe("createEntitiesRepository (whiteboard)", () => {
	it("save creates with the caller id when absent, updates when present", async () => {
		const e = new MockEntities();
		const repo = createEntitiesRepository(e);

		await repo.saveWhiteboard(makeWhiteboard({ id: "wb-a", name: "A" }));
		expect(e.create).toHaveBeenCalledWith(WHITEBOARD_TYPE, expect.any(Object), "wb-a");

		await repo.saveWhiteboard(makeWhiteboard({ id: "wb-a", name: "A renamed" }));
		expect(e.update).toHaveBeenCalledWith("wb-a", expect.objectContaining({ name: "A renamed" }));
		expect(e.create).toHaveBeenCalledTimes(1);

		await repo.saveEdge(makeEdge({ id: "e-a", whiteboardId: "wb-a" }));
		expect(e.create).toHaveBeenCalledWith(EDGE_TYPE, expect.any(Object), "e-a");
	});

	it("listAll splits boards and edges and preserves domain ts + inline nodes", async () => {
		const e = new MockEntities();
		const repo = createEntitiesRepository(e);
		await repo.saveWhiteboard(makeWhiteboard({ id: "wb1", createdAt: 7, updatedAt: 9 }));
		await repo.saveEdge(makeEdge({ id: "e1", whiteboardId: "wb1", createdAt: 7 }));

		const { whiteboards, edges } = await repo.listAll();
		expect(whiteboards).toHaveLength(1);
		expect(whiteboards[0]).toMatchObject({ id: "wb1", createdAt: 7, updatedAt: 9 });
		expect(whiteboards[0]?.nodes).toHaveLength(1);
		expect(edges).toHaveLength(1);
		expect(edges[0]).toMatchObject({ id: "e1", whiteboardId: "wb1", createdAt: 7 });
	});

	it("remove delegates to entities.delete", async () => {
		const e = new MockEntities();
		const repo = createEntitiesRepository(e);
		await repo.saveWhiteboard(makeWhiteboard({ id: "wb9" }));
		await repo.removeWhiteboard("wb9");
		expect(e.delete).toHaveBeenCalledWith("wb9");

		await repo.saveEdge(makeEdge({ id: "e9" }));
		await repo.removeEdge("e9");
		expect(e.delete).toHaveBeenCalledWith("e9");
	});

	it("listAll degrades to empty on a query failure", async () => {
		const e = new MockEntities();
		e.query.mockRejectedValueOnce(new Error("db locked"));
		expect(await createEntitiesRepository(e).listAll()).toEqual({ whiteboards: [], edges: [] });
	});
});
