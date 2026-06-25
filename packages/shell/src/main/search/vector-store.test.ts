import { describe, expect, it } from "vitest";
import {
	InMemoryVectorStore,
	type VectorRow,
	assertDim,
	blobToEmbedding,
	cosineDistance,
	embeddingToBlob,
} from "./vector-store";

const DIM = 4;

function row(entityId: string, type: string, embedding: number[], updatedAt = 0): VectorRow {
	return { entityId, type, ownerAppId: "app", updatedAt, embedding: new Float32Array(embedding) };
}

describe("blob round-trip", () => {
	it("serialises and restores a Float32Array losslessly", () => {
		const v = new Float32Array([0.25, -0.5, 1.5, 0]);
		const back = blobToEmbedding(embeddingToBlob(v));
		expect(Array.from(back)).toEqual(Array.from(v));
	});

	it("embeddingToBlob copies, not views (caller buffer reuse is safe)", () => {
		const v = new Float32Array([1, 2, 3, 4]);
		const blob = embeddingToBlob(v);
		v[0] = 99;
		expect(blobToEmbedding(blob)[0]).toBe(1);
	});
});

describe("cosineDistance", () => {
	it("is 0 for identical direction, 1 for orthogonal, 2 for opposite", () => {
		expect(cosineDistance(new Float32Array([1, 0]), new Float32Array([1, 0]))).toBeCloseTo(0, 6);
		expect(cosineDistance(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(1, 6);
		expect(cosineDistance(new Float32Array([1, 0]), new Float32Array([-1, 0]))).toBeCloseTo(2, 6);
	});

	it("returns 1 (never NaN) against a zero vector", () => {
		expect(cosineDistance(new Float32Array([0, 0]), new Float32Array([1, 1]))).toBe(1);
	});
});

describe("assertDim", () => {
	it("throws on a dimension mismatch", () => {
		expect(() => assertDim(new Float32Array(3), 4)).toThrow(/dimension/);
		expect(() => assertDim(new Float32Array(4), 4)).not.toThrow();
	});
});

describe("InMemoryVectorStore", () => {
	it("upserts and counts; upsert replaces, never duplicates", () => {
		const s = new InMemoryVectorStore(DIM);
		s.upsert(row("a", "note", [1, 0, 0, 0]));
		s.upsert(row("a", "note", [0, 1, 0, 0]));
		expect(s.count()).toBe(1);
	});

	it("rejects a wrong-dimension embedding (fail-closed)", () => {
		const s = new InMemoryVectorStore(DIM);
		expect(() => s.upsert(row("a", "note", [1, 0, 0]))).toThrow(/dimension/);
	});

	it("queryNearest returns k results ordered by ascending distance", () => {
		const s = new InMemoryVectorStore(DIM);
		s.upsert(row("near", "note", [1, 0, 0, 0]));
		s.upsert(row("mid", "note", [0.7, 0.7, 0, 0]));
		s.upsert(row("far", "note", [0, 1, 0, 0]));
		const hits = s.queryNearest(new Float32Array([1, 0, 0, 0]), 2);
		expect(hits.map((h) => h.entityId)).toEqual(["near", "mid"]);
		expect(hits[0]?.distance).toBeLessThan(hits[1]?.distance ?? Number.POSITIVE_INFINITY);
	});

	it("breaks distance ties by updatedAt desc", () => {
		const s = new InMemoryVectorStore(DIM);
		s.upsert(row("old", "note", [1, 0, 0, 0], 100));
		s.upsert(row("new", "note", [1, 0, 0, 0], 200));
		const hits = s.queryNearest(new Float32Array([1, 0, 0, 0]), 2);
		expect(hits.map((h) => h.entityId)).toEqual(["new", "old"]);
	});

	it("filters by type", () => {
		const s = new InMemoryVectorStore(DIM);
		s.upsert(row("n", "note", [1, 0, 0, 0]));
		s.upsert(row("t", "task", [1, 0, 0, 0]));
		const hits = s.queryNearest(new Float32Array([1, 0, 0, 0]), 10, ["task"]);
		expect(hits.map((h) => h.entityId)).toEqual(["t"]);
	});

	it("remove deletes the row", () => {
		const s = new InMemoryVectorStore(DIM);
		s.upsert(row("a", "note", [1, 0, 0, 0]));
		s.remove("a");
		expect(s.count()).toBe(0);
	});

	it("rebuild replaces the whole store atomically", () => {
		const s = new InMemoryVectorStore(DIM);
		s.upsert(row("old", "note", [1, 0, 0, 0]));
		s.rebuild([row("x", "note", [0, 1, 0, 0]), row("y", "task", [0, 0, 1, 0])]);
		expect(s.count()).toBe(2);
		expect(
			s
				.queryNearest(new Float32Array([1, 0, 0, 0]), 10)
				.map((h) => h.entityId)
				.sort(),
		).toEqual(["x", "y"]);
	});

	it("stored vectors are isolated from later caller mutation", () => {
		const s = new InMemoryVectorStore(DIM);
		const v = new Float32Array([1, 0, 0, 0]);
		s.upsert({ entityId: "a", type: "note", ownerAppId: "app", updatedAt: 0, embedding: v });
		v[0] = 99;
		const hit = s.queryNearest(new Float32Array([1, 0, 0, 0]), 1)[0];
		expect(hit?.distance).toBeCloseTo(0, 6);
	});

	it("throws after dispose", () => {
		const s = new InMemoryVectorStore(DIM);
		s.dispose();
		expect(() => s.count()).toThrow(/disposed/);
	});
});
