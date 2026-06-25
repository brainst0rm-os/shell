/**
 * `GraphView/v1` repository tests (9.13.6). Drives the repo against the
 * shared in-memory entities fake: default-view ensure semantics (create
 * once, then reuse), coordinate round-trip through the Y.Doc transport,
 * concurrent-writer merge, and graceful degradation when the doc surface
 * is absent.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { NodeCoord } from "../logic/graph-view-yjs-codec";
import { makeFakeEntities } from "../test/fake-entities";
import {
	GRAPH_VIEW_TYPE,
	createGraphViewRepository,
	defaultGraphViewProperties,
} from "./graph-view-repository";

function coords(entries: Record<string, NodeCoord>): Map<string, NodeCoord> {
	return new Map(Object.entries(entries));
}

describe("graph-view-repository", () => {
	let fake: ReturnType<typeof makeFakeEntities>;
	beforeEach(() => {
		fake = makeFakeEntities();
	});

	it("ensureDefaultView creates a GraphView/v1 entity once, then reuses it", async () => {
		const repo = createGraphViewRepository(fake.entities);

		const first = await repo.ensureDefaultView("graph-1", "Layout");
		expect(first).not.toBeNull();
		expect(first?.graphId).toBe("graph-1");
		expect(first?.name).toBe("Layout");

		const again = await repo.ensureDefaultView("graph-1", "Other name");
		expect(again?.id).toBe(first?.id);

		const stored = [...fake.records.values()].filter((r) => r.type === GRAPH_VIEW_TYPE);
		expect(stored).toHaveLength(1);
	});

	it("ensureDefaultView scopes to the graph — two graphs get two views", async () => {
		const repo = createGraphViewRepository(fake.entities);
		const a = await repo.ensureDefaultView("graph-a", "Layout");
		const b = await repo.ensureDefaultView("graph-b", "Layout");
		expect(a?.id).not.toBe(b?.id);
		expect(await repo.listViews("graph-a")).toHaveLength(1);
		expect(await repo.listViews("graph-b")).toHaveLength(1);
	});

	it("the default property bag carries the manifest schema's required fields", () => {
		const props = defaultGraphViewProperties("g1", "Layout", 123);
		expect(props.graphId).toBe("g1");
		expect(props.name).toBe("Layout");
		expect(props.kind).toBe("full");
		expect(props.layoutOptions).toBeDefined();
		expect(props.visibility).toBeDefined();
		expect(props.settings).toBeDefined();
		expect(props.history).toBeDefined();
		expect(props.ordering).toBeDefined();
		expect(props.createdAt).toBe(123);
		expect(props.updatedAt).toBe(123);
	});

	it("round-trips coordinates through the Y.Doc transport", async () => {
		const repo = createGraphViewRepository(fake.entities);
		const view = await repo.ensureDefaultView("graph-1", "Layout");
		if (!view) throw new Error("ensureDefaultView failed");

		const set = coords({
			n1: { x: 12, y: 34, pinned: true },
			n2: { x: -5.5, y: 0.25, pinned: true },
		});
		await repo.saveViewCoords(view.id, set);
		expect(await repo.loadViewCoords(view.id)).toEqual(set);

		// Second save replaces removed nodes + moves survivors.
		const next = coords({ n1: { x: 99, y: 100, pinned: true } });
		await repo.saveViewCoords(view.id, next);
		expect(await repo.loadViewCoords(view.id)).toEqual(next);
	});

	it("saveViewCoords merges with concurrent writes to other nodes", async () => {
		const repo = createGraphViewRepository(fake.entities);
		const view = await repo.ensureDefaultView("graph-1", "Layout");
		if (!view) throw new Error("ensureDefaultView failed");

		await repo.saveViewCoords(
			view.id,
			coords({ n1: { x: 1, y: 1, pinned: true }, n2: { x: 2, y: 2, pinned: true } }),
		);
		// A second writer (same persisted state) moves only n2; the doc-level
		// merge keeps n1.
		await repo.saveViewCoords(
			view.id,
			coords({ n1: { x: 1, y: 1, pinned: true }, n2: { x: 50, y: 60, pinned: true } }),
		);
		expect(await repo.loadViewCoords(view.id)).toEqual(
			coords({ n1: { x: 1, y: 1, pinned: true }, n2: { x: 50, y: 60, pinned: true } }),
		);
	});

	it("saveViewCoords bumps the entity's updatedAt", async () => {
		const repo = createGraphViewRepository(fake.entities);
		const view = await repo.ensureDefaultView("graph-1", "Layout");
		if (!view) throw new Error("ensureDefaultView failed");
		const before = fake.records.get(view.id)?.properties.updatedAt as number;

		await new Promise((r) => setTimeout(r, 5));
		await repo.saveViewCoords(view.id, coords({ n1: { x: 1, y: 2, pinned: true } }));

		const after = fake.records.get(view.id)?.properties.updatedAt as number;
		expect(after).toBeGreaterThan(before);
	});

	it("degrades to an empty map when the doc surface is absent", async () => {
		const { loadDoc, applyDoc, closeDoc, ...crudOnly } = fake.entities;
		const repo = createGraphViewRepository(crudOnly);
		const view = await repo.ensureDefaultView("graph-1", "Layout");
		if (!view) throw new Error("ensureDefaultView failed");

		await repo.saveViewCoords(view.id, coords({ n1: { x: 1, y: 2, pinned: true } }));
		expect((await repo.loadViewCoords(view.id)).size).toBe(0);
		await repo.closeView(view.id); // no-throw
	});

	it("listViews returns views oldest-first and ignores other types", async () => {
		const repo = createGraphViewRepository(fake.entities);
		await fake.entities.create("brainstorm/Note/v1", { title: "not a view" });
		const v1 = await fake.entities.create(GRAPH_VIEW_TYPE, {
			...defaultGraphViewProperties("g", "A"),
		});
		// Force a distinct createdAt ordering.
		fake.records.set(v1.id, { ...v1, createdAt: 1 });
		const v2 = await fake.entities.create(GRAPH_VIEW_TYPE, {
			...defaultGraphViewProperties("g", "B"),
		});
		fake.records.set(v2.id, { ...(fake.records.get(v2.id) as typeof v2), createdAt: 2 });

		const views = await repo.listViews("g");
		expect(views.map((v) => v.name)).toEqual(["A", "B"]);
	});
});
