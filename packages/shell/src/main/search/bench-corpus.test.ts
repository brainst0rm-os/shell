/**
 * Tests for the bench corpus generator. The bench is reproducible only if
 * the corpus is — every property here is load-bearing for cross-run +
 * cross-engine comparability.
 */

import { describe, expect, it } from "vitest";
import {
	type BenchCorpusOptions,
	BenchQueryKind,
	buildBenchQueries,
	makeBenchCorpus,
	makeSeededRng,
} from "./bench-corpus";
import { isIndexable } from "./search-indexer";

describe("makeSeededRng", () => {
	it("is deterministic for the same seed", () => {
		const a = makeSeededRng(1234);
		const b = makeSeededRng(1234);
		const seqA = Array.from({ length: 32 }, () => a());
		const seqB = Array.from({ length: 32 }, () => b());
		expect(seqA).toEqual(seqB);
	});

	it("diverges for different seeds", () => {
		const a = makeSeededRng(1);
		const b = makeSeededRng(2);
		const seqA = Array.from({ length: 32 }, () => a());
		const seqB = Array.from({ length: 32 }, () => b());
		expect(seqA).not.toEqual(seqB);
	});

	it("emits values in [0, 1)", () => {
		const r = makeSeededRng(42);
		for (let i = 0; i < 1000; i += 1) {
			const v = r();
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(1);
		}
	});
});

describe("makeBenchCorpus", () => {
	const base: BenchCorpusOptions = { seed: 7, size: 100 };

	it("returns exactly `size` entities", () => {
		expect(makeBenchCorpus(base).length).toBe(100);
		expect(makeBenchCorpus({ seed: 7, size: 0 }).length).toBe(0);
		expect(makeBenchCorpus({ seed: 7, size: 5 }).length).toBe(5);
	});

	it("is byte-deterministic for the same (seed, size)", () => {
		const a = makeBenchCorpus(base);
		const b = makeBenchCorpus(base);
		expect(a).toEqual(b);
	});

	it("diverges for a different seed", () => {
		const a = makeBenchCorpus({ seed: 1, size: 50 });
		const b = makeBenchCorpus({ seed: 2, size: 50 });
		expect(a).not.toEqual(b);
		// But the *count* matches — divergence is only content.
		expect(a.length).toBe(b.length);
	});

	it("emits unique stable entity ids in input order", () => {
		const corpus = makeBenchCorpus({ seed: 11, size: 1000 });
		const ids = corpus.map((e) => e.entityId);
		expect(new Set(ids).size).toBe(1000);
		// Stable form: bench-000000, bench-000001, … in base-36.
		expect(ids[0]).toBe("bench-000000");
		expect(ids[1]).toBe("bench-000001");
		expect(ids[35]).toBe("bench-00000z"); // base-36 boundary
	});

	it("emits indexable entities (non-empty title + body)", () => {
		const corpus = makeBenchCorpus({ seed: 3, size: 50 });
		for (const e of corpus) {
			expect(e.title.trim().length).toBeGreaterThan(0);
			expect(e.body.trim().length).toBeGreaterThan(0);
			expect(isIndexable(e)).toBe(true);
		}
	});

	it("body length sits within configured bounds", () => {
		const corpus = makeBenchCorpus({
			seed: 99,
			size: 200,
			bodyMinTokens: 50,
			bodyMaxTokens: 100,
		});
		for (const e of corpus) {
			const tokens = e.body.split(/\s+/).filter((t) => t.length > 0 && t !== "\n").length;
			expect(tokens).toBeGreaterThanOrEqual(50);
			// +1 for the occasional rare-word splice + paragraph breaks
			expect(tokens).toBeLessThanOrEqual(110);
		}
	});

	it("rotates across all 8 declared entity types over a large corpus", () => {
		const corpus = makeBenchCorpus({ seed: 5, size: 5000 });
		const types = new Set(corpus.map((e) => e.type));
		expect(types.size).toBe(8);
		// Each type should land at least ~5% of the time (uniform-ish).
		const counts = new Map<string, number>();
		for (const e of corpus) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
		for (const n of counts.values()) {
			expect(n / corpus.length).toBeGreaterThan(0.05);
		}
	});

	it("derives ownerAppId from the type's BP-style prefix", () => {
		const corpus = makeBenchCorpus({ seed: 1, size: 200 });
		for (const e of corpus) {
			// io.brainstorm.notes/Note/v1 → io.brainstorm.notes
			const expected = e.type.split("/")[0];
			expect(e.ownerAppId).toBe(expected);
		}
	});

	it("plants rare words at the configured rate (loose tolerance)", () => {
		const rareWords = new Set([
			"quintessence",
			"penumbra",
			"shibboleth",
			"perambulate",
			"susurrus",
			"vellichor",
			"phosphene",
			"obsidian",
			"isthmus",
			"cumulus",
		]);
		const corpus = makeBenchCorpus({ seed: 13, size: 10000, rareWordRate: 0.01 });
		let hits = 0;
		for (const e of corpus) {
			for (const w of rareWords) {
				if (e.body.includes(w)) {
					hits += 1;
					break;
				}
			}
		}
		// 1% rate ± big tolerance — RNG-driven, must not flake.
		expect(hits).toBeGreaterThan(20);
		expect(hits).toBeLessThan(300);
	});

	it("contains the common bench word 'alpha' on most bodies", () => {
		// The bench's CommonSingleTerm query is `alpha`; if the corpus
		// rarely emits it the query degenerates into a rare-term measure.
		const corpus = makeBenchCorpus({ seed: 17, size: 1000 });
		let hits = 0;
		for (const e of corpus) {
			if (e.body.includes("alpha")) hits += 1;
		}
		expect(hits / corpus.length).toBeGreaterThan(0.5);
	});
});

describe("buildBenchQueries", () => {
	it("emits one entry per BenchQueryKind", () => {
		const qs = buildBenchQueries();
		const kinds = new Set(qs.map((q) => q.kind));
		expect(kinds.size).toBe(qs.length);
		for (const k of Object.values(BenchQueryKind)) {
			expect(kinds.has(k)).toBe(true);
		}
	});

	it("attaches a types filter only to the CommonWithTypeFilter shape", () => {
		const qs = buildBenchQueries();
		for (const q of qs) {
			const expectsFilter = q.kind === BenchQueryKind.CommonWithTypeFilter;
			expect(q.types !== undefined).toBe(expectsFilter);
		}
	});
});
