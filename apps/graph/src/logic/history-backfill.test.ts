import { describe, expect, it } from "vitest";
import { backfillCreatedAt } from "./history-backfill";
import type { EntityRow, InMemoryGraph, LinkRow } from "./in-memory-graph";

const ent = (id: string, createdAt: number): EntityRow => ({
	id,
	type: "io.brainstorm.notes/Note/v1",
	properties: {},
	createdAt,
	updatedAt: createdAt,
	deletedAt: null,
});

const link = (
	id: string,
	sourceEntityId: string,
	destEntityId: string,
	createdAt: number,
): LinkRow => ({
	id,
	sourceEntityId,
	destEntityId,
	linkType: "mention",
	createdAt,
	deletedAt: null,
});

const T = 1_700_000_000_000;

describe("backfillCreatedAt", () => {
	it("leaves a fully-timestamped graph untouched", () => {
		const g: InMemoryGraph = {
			entities: [ent("a", T), ent("b", T + 100)],
			links: [link("l1", "a", "b", T + 200)],
		};
		expect(backfillCreatedAt(g)).toEqual(g);
	});

	it("a timeless link inherits its source entity's timestamp", () => {
		const g: InMemoryGraph = {
			entities: [ent("a", T), ent("b", T + 100)],
			links: [link("l1", "a", "b", 0)],
		};
		const out = backfillCreatedAt(g);
		expect(out.links[0]?.createdAt).toBe(T); // source 'a'
	});

	it("never moves a real link timestamp earlier than its source (MAX semantics)", () => {
		// Link older than its source can't exist — clamp up to the source.
		const g: InMemoryGraph = {
			entities: [ent("a", T + 500)],
			links: [link("l1", "a", "b", T)],
		};
		expect(backfillCreatedAt(g).links[0]?.createdAt).toBe(T + 500);
	});

	it("keeps a link timestamp that is later than its source", () => {
		const g: InMemoryGraph = {
			entities: [ent("a", T)],
			links: [link("l1", "a", "b", T + 999)],
		};
		expect(backfillCreatedAt(g).links[0]?.createdAt).toBe(T + 999);
	});

	it("a timeless entity falls back to the minimum known timestamp (not epoch 0)", () => {
		const g: InMemoryGraph = {
			entities: [ent("old", T), ent("legacy", 0)],
			links: [],
		};
		expect(backfillCreatedAt(g).entities[1]?.createdAt).toBe(T);
	});

	it("a link whose source entity is also timeless resolves to the floor", () => {
		const g: InMemoryGraph = {
			entities: [ent("recent", T + 1000), ent("src", 0)],
			links: [link("l1", "src", "recent", 0)],
		};
		const out = backfillCreatedAt(g);
		// 'src' backfills to the floor (T+1000, the only usable ts); the
		// link inherits that.
		expect(out.entities.find((e) => e.id === "src")?.createdAt).toBe(T + 1000);
		expect(out.links[0]?.createdAt).toBe(T + 1000);
	});

	it("a link to an absent source entity still resolves to the floor", () => {
		const g: InMemoryGraph = {
			entities: [ent("only", T)],
			links: [link("l1", "ghost", "only", 0)],
		};
		expect(backfillCreatedAt(g).links[0]?.createdAt).toBe(T);
	});

	it("is idempotent — backfill(backfill(g)) deep-equals backfill(g)", () => {
		const g: InMemoryGraph = {
			entities: [ent("a", T), ent("legacy", 0)],
			links: [link("l1", "a", "legacy", 0), link("l2", "legacy", "a", T + 50)],
		};
		const once = backfillCreatedAt(g);
		expect(backfillCreatedAt(once)).toEqual(once);
	});

	it("does not mutate the input graph", () => {
		const g: InMemoryGraph = {
			entities: [ent("legacy", 0)],
			links: [link("l1", "legacy", "legacy", 0)],
		};
		const snapshot = structuredClone(g);
		backfillCreatedAt(g);
		expect(g).toEqual(snapshot);
	});

	it("empty / all-timeless graphs degrade without throwing", () => {
		expect(backfillCreatedAt({ entities: [], links: [] })).toEqual({ entities: [], links: [] });
		const allZero: InMemoryGraph = {
			entities: [ent("a", 0)],
			links: [link("l1", "a", "a", 0)],
		};
		const out = backfillCreatedAt(allZero);
		// No usable timestamp anywhere → floor 0 → values stay 0 (no crash,
		// no NaN, no epoch explosion beyond the already-zero input).
		expect(out.entities[0]?.createdAt).toBe(0);
		expect(out.links[0]?.createdAt).toBe(0);
	});
});
