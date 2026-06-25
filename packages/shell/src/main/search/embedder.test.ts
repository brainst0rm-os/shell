import { describe, expect, it } from "vitest";
import { EMBEDDING_DIM, StubEmbedder } from "./embedder";

function l2(v: Float32Array): number {
	let s = 0;
	for (const x of v) s += x * x;
	return Math.sqrt(s);
}

describe("StubEmbedder", () => {
	const e = new StubEmbedder();

	it("emits a vector of EMBEDDING_DIM length", () => {
		expect(e.dim).toBe(EMBEDDING_DIM);
		expect(e.embed("hello world").length).toBe(EMBEDDING_DIM);
	});

	it("is deterministic — same text yields a byte-identical vector", () => {
		const a = e.embed("the quick brown fox");
		const b = e.embed("the quick brown fox");
		expect(Array.from(a)).toEqual(Array.from(b));
	});

	it("is order/case-insensitive at the bag-of-tokens level it claims to be", () => {
		// Hashing-trick bag-of-words: same multiset of lowercased tokens →
		// same vector regardless of order or case.
		const a = e.embed("Quick Brown Fox");
		const b = e.embed("fox brown quick");
		expect(Array.from(a)).toEqual(Array.from(b));
	});

	it("produces a unit-length vector for non-empty text", () => {
		expect(l2(e.embed("alpha beta gamma"))).toBeCloseTo(1, 5);
	});

	it("returns an all-zero vector for empty / token-less input (no NaN)", () => {
		for (const input of ["", "   ", "!!!", "—"]) {
			const v = e.embed(input);
			expect(v.length).toBe(EMBEDDING_DIM);
			expect(Array.from(v).every((x) => x === 0)).toBe(true);
			expect(Array.from(v).some(Number.isNaN)).toBe(false);
		}
	});

	it("distinguishes different content", () => {
		const a = e.embed("database vector search");
		const b = e.embed("calendar event reminder");
		expect(Array.from(a)).not.toEqual(Array.from(b));
	});

	it("honours a custom dimension", () => {
		const small = new StubEmbedder(8);
		expect(small.dim).toBe(8);
		expect(small.embed("x y z").length).toBe(8);
		expect(l2(small.embed("x y z"))).toBeCloseTo(1, 5);
	});

	it("carries a stable name for vector provenance", () => {
		expect(e.name).toBe("stub-v1");
	});
});
