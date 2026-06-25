/**
 * Reciprocal Rank Fusion (RRF) — the rank-combiner behind `search.hybrid`
 * (11.4). It merges N ranked result lists by **rank, not raw score**, so the
 * lexical path's BM25 (negative, ascending-better) and the vector path's cosine
 * distance never need to be normalised onto a shared scale — the classic
 * failure mode of weighted-score fusion. Each id scores `Σ 1/(k + rank)` over
 * the lists it appears in (rank is 1-based); `k` damps the tail so a top hit in
 * one list outweighs a long tail in another. `k = 60` is the canonical default
 * (Cormack, Clarke & Büttcher, 2009).
 *
 * Pure + dependency-free so the fusion is unit-tested without an index. Ties
 * keep first-seen order (lists are passed lexical-first), via the stable sort
 * over insertion-ordered map entries — deterministic, so an object's hybrid
 * ranking reads the same every run.
 */

export type RankedRef = { readonly id: string };
export type FusedRef = { id: string; score: number };

/** The canonical RRF damping constant. */
export const RRF_K = 60;

export function reciprocalRankFusion(
	lists: ReadonlyArray<ReadonlyArray<RankedRef>>,
	k: number = RRF_K,
): FusedRef[] {
	const scores = new Map<string, number>();
	for (const list of lists) {
		for (let rank = 0; rank < list.length; rank++) {
			const id = list[rank]?.id;
			if (id === undefined) continue;
			scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
		}
	}
	return [...scores.entries()]
		.map(([id, score]) => ({ id, score }))
		.sort((a, b) => b.score - a.score);
}
