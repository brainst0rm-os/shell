/**
 * Fuzzy file ranking for the quick-open palette (9.7.5).
 *
 * A classic subsequence matcher: every character of the (lower-cased) query
 * must appear in order in the candidate, but not necessarily contiguously.
 * Scoring rewards the matches a developer's muscle memory expects — a hit in
 * the file's basename far outweighs one buried in the directory path,
 * consecutive characters and matches right after a separator (`/`, `.`, `-`,
 * `_`) score extra, and a shorter candidate breaks ties. Pure + DOM-free so
 * the palette's ranking is unit-tested without booting the app.
 */

export interface FuzzyFile {
	id: string;
	path: string;
}

const SEPARATORS = new Set(["/", "\\", ".", "-", "_", " "]);

/** Score `query` against one string, or null when it isn't a subsequence.
 *  Higher is better; 0 is a valid (weak) match. */
export function fuzzyScore(query: string, text: string): number | null {
	if (query === "") return 0;
	const q = query.toLowerCase();
	const t = text.toLowerCase();
	let score = 0;
	let ti = 0;
	let lastMatch = -2;
	for (let qi = 0; qi < q.length; qi++) {
		const ch = q[qi];
		const found = t.indexOf(ch ?? "", ti);
		if (found === -1) return null;
		// Consecutive run bonus.
		if (found === lastMatch + 1) score += 5;
		// Boundary bonus: start of string or right after a separator.
		if (found === 0 || SEPARATORS.has(t[found - 1] ?? "")) score += 3;
		// Earlier matches are slightly better than later ones.
		score += Math.max(0, 2 - found * 0.01);
		lastMatch = found;
		ti = found + 1;
	}
	return score;
}

function basename(path: string): string {
	const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	return slash === -1 ? path : path.slice(slash + 1);
}

/**
 * Rank `files` against `query`. An empty query returns every file in input
 * order (the palette's resting state). Otherwise only matches are kept,
 * scored by the better of their basename match (with a strong bonus, since
 * that's what people type) and their full-path match; ties break toward the
 * shorter path, then stable input order.
 */
export function rankFiles<T extends FuzzyFile>(files: readonly T[], query: string): T[] {
	const q = query.trim();
	if (q === "") return [...files];

	const scored: { item: T; score: number; index: number }[] = [];
	for (let index = 0; index < files.length; index++) {
		const item = files[index];
		if (!item) continue;
		const base = fuzzyScore(q, basename(item.path));
		const full = fuzzyScore(q, item.path);
		if (base === null && full === null) continue;
		const score = Math.max((base ?? Number.NEGATIVE_INFINITY) + 12, full ?? Number.NEGATIVE_INFINITY);
		scored.push({ item, score, index });
	}

	scored.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		const lenDiff = a.item.path.length - b.item.path.length;
		if (lenDiff !== 0) return lenDiff;
		return a.index - b.index;
	});
	return scored.map((s) => s.item);
}
