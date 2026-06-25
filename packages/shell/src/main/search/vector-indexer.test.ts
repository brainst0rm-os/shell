import { describe, expect, it } from "vitest";
import { EMBEDDING_DIM, StubEmbedder } from "./embedder";
import type { IndexableEntity } from "./search-indexer";
import { VectorIndexer } from "./vector-indexer";
import { InMemoryVectorStore } from "./vector-store";

function ent(entityId: string, type: string, title: string, body = ""): IndexableEntity {
	return { entityId, type, ownerAppId: "io.brainstorm.notes", title, body };
}

function make(): VectorIndexer {
	return new VectorIndexer(new InMemoryVectorStore(EMBEDDING_DIM), new StubEmbedder());
}

describe("VectorIndexer", () => {
	it("fails closed on an embedder/store dimension mismatch", () => {
		expect(() => new VectorIndexer(new InMemoryVectorStore(16), new StubEmbedder(384))).toThrow(
			/dim/,
		);
	});

	it("indexes an entity and finds it by its own text", async () => {
		const ix = make();
		await ix.indexEntity(ent("a", "note", "vector search", "embeddings nearest neighbour"));
		expect(ix.count()).toBe(1);
		const hits = await ix.query("vector search embeddings");
		expect(hits[0]?.entityId).toBe("a");
	});

	it("ranks the most textually-similar entity first", async () => {
		const ix = make();
		await ix.indexEntity(
			ent("db", "note", "vector database index", "cosine nearest neighbour search"),
		);
		await ix.indexEntity(ent("cal", "note", "calendar event reminder", "schedule meeting tomorrow"));
		const hits = await ix.query("vector database cosine search");
		expect(hits[0]?.entityId).toBe("db");
	});

	it("re-indexing the same id replaces, never duplicates", async () => {
		const ix = make();
		await ix.indexEntity(ent("a", "note", "first version"));
		await ix.indexEntity(ent("a", "note", "second version entirely different"));
		expect(ix.count()).toBe(1);
	});

	it("drops an entity that became blank (no longer indexable)", async () => {
		const ix = make();
		await ix.indexEntity(ent("a", "note", "has content"));
		expect(ix.count()).toBe(1);
		await ix.indexEntity(ent("a", "note", "", ""));
		expect(ix.count()).toBe(0);
	});

	it("removeEntity deletes the embedding", async () => {
		const ix = make();
		await ix.indexEntity(ent("a", "note", "content"));
		ix.removeEntity("a");
		expect(ix.count()).toBe(0);
	});

	it("rebuild repopulates from sources atomically, skipping non-indexable", async () => {
		const ix = make();
		await ix.indexEntity(ent("stale", "note", "old"));
		await ix.rebuild([
			ent("x", "note", "alpha"),
			ent("blank", "note", "", ""),
			ent("y", "task", "beta"),
		]);
		expect(ix.count()).toBe(2);
		const hits = await ix.query("alpha beta");
		expect(hits.map((h) => h.entityId).sort()).toEqual(["x", "y"]);
	});

	it("filters query results by type", async () => {
		const ix = make();
		await ix.indexEntity(ent("n", "note", "shared word alpha"));
		await ix.indexEntity(ent("t", "task", "shared word alpha"));
		const hits = await ix.query("shared word alpha", 10, ["task"]);
		expect(hits.map((h) => h.entityId)).toEqual(["t"]);
	});

	it("returns no hits for an empty / token-less query", async () => {
		const ix = make();
		await ix.indexEntity(ent("a", "note", "content"));
		expect(await ix.query("")).toEqual([]);
		expect(await ix.query("   !!!   ")).toEqual([]);
	});

	it("throws after dispose", async () => {
		const ix = make();
		ix.dispose();
		await expect(ix.indexEntity(ent("a", "note", "x"))).rejects.toThrow(/disposed/);
	});
});
