/**
 * `Graph/v1` repository tests (9.13.2). Exercises the `entities` service
 * surface + Y.Doc replica transport with the shared in-memory fake
 * (`test/fake-entities.ts`) — same shape as the canonical tasks repository
 * test, so the wiring is verified end-to-end without spinning up the real
 * broker.
 *
 * The trivial-pattern round-trip (the 9.13.2 green bar) goes
 * `createGraph` → `loadGraph` → `saveGraphPattern` → `loadGraph` and
 * asserts the pattern is identical at every observation.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { makeFakeEntities } from "../test/fake-entities";
import { type GraphPattern, SubjectKind } from "../types/pattern";
import { GRAPH_TYPE, createGraphRepository } from "./graph-repository";

function trivialPattern(): GraphPattern {
	return {
		subjects: {
			S1: {
				kind: SubjectKind.Entity,
				types: ["brainstorm/Note/v1"],
				where: null,
				displayName: "Notes",
				color: null,
				icon: null,
				limit: null,
			},
		},
		edges: [],
		primarySubject: "S1",
	};
}

describe("graph-repository", () => {
	let fake: ReturnType<typeof makeFakeEntities>;
	beforeEach(() => {
		fake = makeFakeEntities();
	});

	it("creates a Graph/v1 entity and round-trips a trivial pattern", async () => {
		const repo = createGraphRepository(fake.entities);

		const created = await repo.createGraph({ name: "My graph", pattern: trivialPattern() });

		expect(created.name).toBe("My graph");
		expect(created.pattern).toEqual(trivialPattern());

		// Store side: the record carries the metadata only; the pattern lives
		// in the Y.Doc.
		const stored = fake.records.get(created.id);
		expect(stored).toBeDefined();
		expect(stored?.type).toBe(GRAPH_TYPE);
		expect(stored?.properties.name).toBe("My graph");
		expect(fake.docs.has(created.id)).toBe(true);

		// Re-load: same pattern back out, decoded through the codec.
		const reloaded = await repo.loadGraph(created.id);
		expect(reloaded).not.toBeNull();
		expect(reloaded?.pattern).toEqual(trivialPattern());
		expect(reloaded?.name).toBe("My graph");
	});

	it("saveGraphPattern updates the doc + bumps updatedAt", async () => {
		const repo = createGraphRepository(fake.entities);
		const created = await repo.createGraph({ name: "G", pattern: trivialPattern() });
		const initialUpdatedAt = created.updatedAt;

		// Sleep a hair so updatedAt actually moves; Date.now() granularity is ms.
		await new Promise((r) => setTimeout(r, 5));

		const base = trivialPattern();
		const baseS1 = base.subjects.S1;
		if (!baseS1) throw new Error("test setup: trivial pattern missing S1");
		const next: GraphPattern = {
			...base,
			subjects: {
				...base.subjects,
				S1: { ...baseS1, displayName: "Renamed subject" },
			},
		};
		await repo.saveGraphPattern(created.id, next);

		const reloaded = await repo.loadGraph(created.id);
		expect(reloaded?.pattern.subjects.S1?.displayName).toBe("Renamed subject");
		expect((reloaded?.updatedAt ?? 0) >= initialUpdatedAt).toBe(true);
	});

	it("loadGraph returns null when the entity has the wrong type", async () => {
		const repo = createGraphRepository(fake.entities);
		const note = await fake.entities.create("brainstorm/Note/v1", { title: "Not a graph" });
		const result = await repo.loadGraph(note.id);
		expect(result).toBeNull();
	});

	it("loadGraph returns null when the entity is missing", async () => {
		const repo = createGraphRepository(fake.entities);
		const result = await repo.loadGraph("does-not-exist");
		expect(result).toBeNull();
	});

	it("listGraphs returns only Graph/v1 entities", async () => {
		const repo = createGraphRepository(fake.entities);
		await repo.createGraph({ name: "A", pattern: trivialPattern() });
		await repo.createGraph({ name: "B", pattern: trivialPattern() });
		await fake.entities.create("brainstorm/Note/v1", { title: "Note" });

		const graphs = await repo.listGraphs();
		expect(graphs).toHaveLength(2);
		expect(graphs.every((g) => g.type === GRAPH_TYPE)).toBe(true);
	});

	it("renameGraph updates the entity's name property", async () => {
		const repo = createGraphRepository(fake.entities);
		const created = await repo.createGraph({ name: "Old", pattern: trivialPattern() });
		await repo.renameGraph(created.id, "New");

		const reloaded = await repo.loadGraph(created.id);
		expect(reloaded?.name).toBe("New");
	});

	it("loadGraph still returns the trivial default pattern when the doc has not been written", async () => {
		// Plant a Graph/v1 entity with no doc body — the entities service can
		// create a row without ever calling applyDoc (the legacy migration
		// path won't write the doc until 9.13.6 lands the per-view coords).
		const created = await fake.entities.create(GRAPH_TYPE, { name: "Bare" });
		const repo = createGraphRepository(fake.entities);
		const loaded = await repo.loadGraph(created.id);

		expect(loaded).not.toBeNull();
		// Codec's empty-doc default — single S1 subject, no edges.
		expect(loaded?.pattern.primarySubject).toBe("S1");
		expect(loaded?.pattern.edges).toEqual([]);
		expect(Object.keys(loaded?.pattern.subjects ?? {})).toEqual(["S1"]);
	});
});
