/**
 * Deterministic synthetic corpus generator for the 11.0 FTS5/Tantivy bench.
 *
 * The bench is reproducible only if the corpus is — different runs against
 * the same `(seed, size)` produce byte-identical entities, byte-identical
 * disk layout, and byte-identical query result sets. Numbers are therefore
 * comparable across machines and across the FTS5↔Tantivy swap; the same
 * function feeds both engines so any divergence comes from the engines, not
 * the inputs.
 *
 * Realistic distributions matter for the result to mean anything:
 *
 *   - **Title** is a short noun-phrase (2–8 tokens) drawn from a small
 *     word pool, then prefixed with one of a handful of nouny stems
 *     ("Note", "Doc", "Spec", …). This mirrors how Brainstorm users name
 *     their objects ("My Q3 plan", "Auth refactor notes", …).
 *   - **Body** is 80–400 tokens of Markov-ish noise from the same word
 *     pool, broken into paragraphs by a deterministic newline rate. Real
 *     bodies are longer and have more structure, but FTS5/Tantivy
 *     tokenise on token-boundaries identically — paragraph structure
 *     doesn't change index size or query latency materially. We
 *     intentionally do NOT use realistic prose because it would bias
 *     measurements towards the prose's term distribution. A
 *     uniform-ish pool stresses the BM25 ranker more honestly.
 *   - **Type** rotates across 8 BP-style ids so type-filtered queries
 *     bench representatively. Distribution is deterministic per seed.
 *   - **Owner app** maps from type so the bench's IPC shape mirrors real
 *     deploys.
 *
 * Spec: §Performance budgets.
 */

import type { IndexableEntity } from "./search-indexer";

/** A tiny seeded PRNG — mulberry32. Deterministic, fast, suitable for
 *  generating corpora; NOT for security. Returns a number in [0, 1). */
export function makeSeededRng(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Pick an integer in `[lo, hi]` (inclusive on both ends). */
function nextInt(rng: () => number, lo: number, hi: number): number {
	return lo + Math.floor(rng() * (hi - lo + 1));
}

/** Pick one of the array's elements, never out-of-bounds. */
function pickOne<T>(rng: () => number, arr: ReadonlyArray<T>): T {
	const i = Math.min(arr.length - 1, Math.floor(rng() * arr.length));
	// biome-ignore lint/style/noNonNullAssertion: bounded above, length asserted by caller via static array literals
	return arr[i]!;
}

const WORD_POOL: ReadonlyArray<string> = [
	"alpha",
	"beta",
	"gamma",
	"delta",
	"sigma",
	"omega",
	"vector",
	"matrix",
	"index",
	"query",
	"token",
	"corpus",
	"render",
	"layout",
	"editor",
	"buffer",
	"flush",
	"hover",
	"click",
	"focus",
	"select",
	"toggle",
	"create",
	"update",
	"delete",
	"search",
	"filter",
	"sort",
	"group",
	"view",
	"list",
	"grid",
	"board",
	"gallery",
	"timeline",
	"calendar",
	"sidebar",
	"inspector",
	"settings",
	"theme",
	"design",
	"system",
	"shell",
	"window",
	"dashboard",
	"launcher",
	"intent",
	"capability",
	"broker",
	"router",
	"service",
	"storage",
	"sqlite",
	"fts",
	"tantivy",
	"vector",
	"embedding",
	"semantic",
	"hybrid",
	"lexical",
	"ranking",
	"score",
	"snippet",
	"match",
	"text",
	"body",
	"title",
	"note",
	"task",
	"event",
	"file",
	"folder",
	"link",
	"mention",
	"bookmark",
	"page",
	"graph",
	"node",
	"edge",
	"property",
	"schema",
	"type",
	"entity",
	"object",
	"id",
	"timestamp",
	"version",
	"hash",
	"crypto",
	"keystore",
	"identity",
	"pairing",
	"sync",
	"yjs",
	"crdt",
	"transaction",
	"commit",
	"undo",
	"redo",
	"selection",
	"clipboard",
];

// Deliberately rare words — surface in only a handful of bodies so that
// queries for them test the narrow-match path (close to the docs.tdf=1
// case). Distribution: ~1 in every 200 entities at the default rate.
const RARE_WORDS: ReadonlyArray<string> = [
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
];

const TITLE_PREFIXES: ReadonlyArray<string> = [
	"Notes on",
	"Spec for",
	"Plan",
	"Review",
	"Recap",
	"Draft",
	"Brief",
	"Memo",
	"Log",
	"Sketch",
];

// 8 representative BP-style type ids — mirrors the spread doc-18 envisions.
const ENTITY_TYPES: ReadonlyArray<string> = [
	"io.brainstorm.notes/Note/v1",
	"io.brainstorm.tasks/Task/v1",
	"io.brainstorm.calendar/Event/v1",
	"io.brainstorm.files/File/v1",
	"io.brainstorm.bookmarks/Bookmark/v1",
	"io.brainstorm.whiteboard/Board/v1",
	"io.brainstorm.journal/Entry/v1",
	"brainstorm/List/v1",
];

/** Pull the publishing app id out of a BP-style entity type — the
 *  segment between scheme-y prefix and the type tail. Falls back to a
 *  fixed string if the type doesn't follow the convention. */
function ownerAppIdFor(type: string): string {
	// "io.brainstorm.notes/Note/v1" → "io.brainstorm.notes"
	const slash = type.indexOf("/");
	return slash > 0 ? type.slice(0, slash) : "brainstorm";
}

export type BenchCorpusOptions = {
	/** Seed for the PRNG; same seed + same size = byte-identical corpus. */
	seed: number;
	/** Number of entities to generate. */
	size: number;
	/** Minimum body length in tokens. Default 80. */
	bodyMinTokens?: number;
	/** Maximum body length in tokens. Default 400. */
	bodyMaxTokens?: number;
	/** Probability per entity that a body carries one of the rare words.
	 *  Default 0.005 (≈1 in 200), tuned for the rare-word query branch. */
	rareWordRate?: number;
};

/**
 * Generate `options.size` synthetic entities deterministically.
 * Identical inputs → identical outputs (no `Date.now()`, no `Math.random()`,
 * no insertion-order sensitivity at the consumer). Run cost is O(size *
 * avg-body-tokens); ~100k entities take ≈1 second to mint on a 2020 M1.
 */
export function makeBenchCorpus(options: BenchCorpusOptions): IndexableEntity[] {
	const size = Math.max(0, Math.floor(options.size));
	const bodyMin = options.bodyMinTokens ?? 80;
	const bodyMax = Math.max(bodyMin, options.bodyMaxTokens ?? 400);
	const rareRate = options.rareWordRate ?? 0.005;
	const rng = makeSeededRng(options.seed);

	const out: IndexableEntity[] = [];
	for (let i = 0; i < size; i += 1) {
		const type = pickOne(rng, ENTITY_TYPES);
		const titleTokens = nextInt(rng, 2, 8);
		const titleParts: string[] = [pickOne(rng, TITLE_PREFIXES)];
		for (let t = 0; t < titleTokens; t += 1) titleParts.push(pickOne(rng, WORD_POOL));
		const title = titleParts.join(" ");

		const bodyTokens = nextInt(rng, bodyMin, bodyMax);
		const bodyParts: string[] = [];
		for (let t = 0; t < bodyTokens; t += 1) {
			bodyParts.push(pickOne(rng, WORD_POOL));
			// Paragraph break ≈ every 25–60 tokens for some structure;
			// FTS5 tokenises identically across newlines and spaces.
			if (t > 0 && t % nextInt(rng, 25, 60) === 0) bodyParts.push("\n");
		}
		if (rng() < rareRate) {
			// Splice a rare word at a deterministic-ish position so queries
			// for it actually have something to hit. Position is chosen via
			// the same RNG to keep the result byte-stable.
			const at = nextInt(rng, 0, bodyParts.length - 1);
			bodyParts.splice(at, 0, pickOne(rng, RARE_WORDS));
		}

		out.push({
			entityId: `bench-${i.toString(36).padStart(6, "0")}`,
			type,
			ownerAppId: ownerAppIdFor(type),
			title,
			body: bodyParts.join(" "),
		});
	}
	return out;
}

/** Canonical query shapes the bench measures — chosen to exercise the
 *  different cost classes of FTS5 / Tantivy in a single pass. The names
 *  ride into the result JSON so cross-run comparison is easy. */
export enum BenchQueryKind {
	/** A single common term — broad match, lots of candidate docs. */
	CommonSingleTerm = "common-single-term",
	/** A single rare term — narrow match, IDF-heavy. */
	RareSingleTerm = "rare-single-term",
	/** Two common terms with implicit AND. */
	TwoTermAnd = "two-term-and",
	/** Three common terms with implicit AND. */
	ThreeTermAnd = "three-term-and",
	/** A common term filtered by `type` — exercises the sidecar join. */
	CommonWithTypeFilter = "common-with-type-filter",
}

export type BenchQuery = {
	kind: BenchQueryKind;
	text: string;
	/** Optional `types` filter, populated only for the type-filter shape. */
	types?: readonly string[];
};

/** A deterministic small set of queries that exercise each `BenchQueryKind`
 *  exactly once. The bench then loops over this set `runs` times for stable
 *  percentile estimates. Picking from the same word pool the corpus uses
 *  guarantees non-empty result sets (a query that always returns nothing
 *  wouldn't measure the result-collection path). */
export function buildBenchQueries(): BenchQuery[] {
	return [
		{ kind: BenchQueryKind.CommonSingleTerm, text: "alpha" },
		{ kind: BenchQueryKind.RareSingleTerm, text: "quintessence" },
		{ kind: BenchQueryKind.TwoTermAnd, text: "alpha beta" },
		{ kind: BenchQueryKind.ThreeTermAnd, text: "alpha beta gamma" },
		{
			kind: BenchQueryKind.CommonWithTypeFilter,
			text: "alpha",
			types: ["io.brainstorm.notes/Note/v1"],
		},
	];
}
