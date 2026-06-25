import { describe, expect, it, vi } from "vitest";
import type { Project } from "../types/project";
import { Priority, type Task } from "../types/task";
import { PROJECT_TYPE, TASK_TYPE, createEntitiesRepository } from "./entities-repository";
import type { EntitiesService, EntityRecord } from "./runtime";

class MockEntities implements EntitiesService {
	private map = new Map<string, EntityRecord>();
	calls: Array<{ op: string; id?: string; type?: string }> = [];

	get = vi.fn(async (id: string): Promise<EntityRecord | null> => {
		this.calls.push({ op: "get", id });
		return this.map.get(id) ?? null;
	});
	query = vi.fn(async (q: { type?: string | string[] }): Promise<EntityRecord[]> => {
		this.calls.push({ op: "query" });
		const types = q.type === undefined ? null : Array.isArray(q.type) ? q.type : [q.type];
		return [...this.map.values()].filter((e) => !types || types.includes(e.type));
	});
	create = vi.fn(
		async (type: string, properties: Record<string, unknown>, id?: string): Promise<EntityRecord> => {
			const eid = id ?? `ent_${this.map.size + 1}`;
			if (this.map.has(eid)) throw new Error(`create: ${eid} already exists`);
			this.calls.push({ op: "create", id: eid, type });
			const rec: EntityRecord = { id: eid, type, properties, createdAt: 1, updatedAt: 1 };
			this.map.set(eid, rec);
			return rec;
		},
	);
	update = vi.fn(async (id: string, patch: Record<string, unknown>): Promise<EntityRecord> => {
		this.calls.push({ op: "update", id });
		const ex = this.map.get(id);
		if (!ex) throw new Error(`update: ${id} missing`);
		const next = { ...ex, properties: { ...ex.properties, ...patch }, updatedAt: 2 };
		this.map.set(id, next);
		return next;
	});
	delete = vi.fn(async (id: string): Promise<void> => {
		this.calls.push({ op: "delete", id });
		this.map.delete(id);
	});

	seedEntity(rec: EntityRecord): void {
		this.map.set(rec.id, rec);
	}
}

const makeTask = (over: Partial<Task> = {}): Task => ({
	id: "t1",
	name: "Task one",
	completedAt: null,
	priority: Priority.None,
	scheduledAt: null,
	dueAt: null,
	projectId: null,
	assigneeId: null,
	parentId: null,
	recurrence: null,
	statusKey: null,
	createdAt: 100,
	updatedAt: 100,
	...over,
});
const makeProject = (over: Partial<Project> = {}): Project => ({
	id: "p1",
	name: "Project one",
	statusKey: null,
	milestoneAt: null,
	colorHint: null,
	createdAt: 50,
	updatedAt: 50,
	...over,
});

describe("createEntitiesRepository", () => {
	it("saveTask creates with the caller id when absent, updates when present", async () => {
		const e = new MockEntities();
		const repo = createEntitiesRepository(e);

		await repo.saveTask(makeTask({ id: "iter-9.1", name: "9.1" }));
		expect(e.create).toHaveBeenCalledWith(TASK_TYPE, expect.any(Object), "iter-9.1");

		await repo.saveTask(makeTask({ id: "iter-9.1", name: "9.1 renamed" }));
		expect(e.update).toHaveBeenCalledWith(
			"iter-9.1",
			expect.objectContaining({ name: "9.1 renamed" }),
		);
		expect(e.create).toHaveBeenCalledTimes(1); // not re-created
	});

	it("listAll maps Task/Project entities back through the codec", async () => {
		const e = new MockEntities();
		const repo = createEntitiesRepository(e);
		await repo.saveTask(makeTask({ id: "t1", priority: Priority.High, projectId: "p1" }));
		await repo.saveProject(makeProject({ id: "p1", colorHint: "#abc123" }));

		const { tasks, projects } = await repo.listAll();
		expect(tasks).toHaveLength(1);
		expect(tasks[0]).toMatchObject({ id: "t1", priority: Priority.High, projectId: "p1" });
		expect(projects).toEqual([
			expect.objectContaining({ id: "p1", colorHint: "#abc123", createdAt: 50 }),
		]);
	});

	it("deleteTask / deleteProject delegate to entities.delete", async () => {
		const e = new MockEntities();
		const repo = createEntitiesRepository(e);
		await repo.saveTask(makeTask({ id: "t9" }));
		await repo.deleteTask("t9");
		expect(e.delete).toHaveBeenCalledWith("t9");
	});

	it("listAll degrades to empty on a query failure (in-memory state is truth)", async () => {
		const e = new MockEntities();
		e.query.mockRejectedValueOnce(new Error("db locked"));
		const repo = createEntitiesRepository(e);
		expect(await repo.listAll()).toEqual({ tasks: [], projects: [] });
	});
});
