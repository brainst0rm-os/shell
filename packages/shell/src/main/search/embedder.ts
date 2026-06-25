/**
 * Text embedding seam for the semantic-search half of Stage 11.
 *
 * `TextEmbedder` is the one interface the vector index depends on; 11.2
 * ships only `StubEmbedder` behind it, and **11.3 drops `LocalE5Embedder`
 * (`multilingual-e5-small` via the `@napi-rs` addon, computed in the search
 * worker) into the same interface with no schema/repo/wiring change** — the
 * same preview-drop shape the lexical half used (the FTS5 indexer shipped
 * under 9.22 ahead of Stage 11; 11.0's `BenchEngine` shipped with only the
 * FTS5 adapter).
 *
 * The dimension is pinned now (`EMBEDDING_DIM`) so the vec0 table 11.2
 * creates is already shaped for the e5 model — no destructive vector-table
 * rebuild when 11.3 lands. `multilingual-e5-small` emits 384-d vectors.
 *
 * `StubEmbedder` is a **deterministic placeholder, not a real model** — its
 * vectors are semantically meaningless (a hashed bag-of-tokens), present
 * only to exercise the storage + maintenance + bench plumbing. It is
 * deterministic by construction (same text → byte-identical vector, the
 * same discipline as the bench corpus PRNG) so tests + the bench are
 * reproducible, and it never reaches for `Date.now()` / `Math.random()`.
 */

/** Vector dimension for the v1 semantic index. Matches
 *  `multilingual-e5-small` (OQ-62 leaning) so the 11.3 model swap needs no
 *  vec0 table migration. Shared by the embedders, the store DDL, and the
 *  fail-closed dimension assert. */
export const EMBEDDING_DIM = 384;

export interface TextEmbedder {
	/** Stable identifier for the embedder (e.g. `"stub-v1"`,
	 *  `"multilingual-e5-small"`) — recorded so a later model swap can
	 *  invalidate vectors minted by an older one. */
	readonly name: string;
	/** Output dimension. Asserted equal to the vector store's table
	 *  dimension on first write (fail-closed). */
	readonly dim: number;
	/** Embed a single text into a unit-length vector of length `dim`.
	 *  Synchronous for the stub; the interface allows a Promise so 11.3's
	 *  worker-computed model can be async without re-shaping callers. */
	embed(text: string): Float32Array | Promise<Float32Array>;
}

/**
 * Deterministic stub embedder — hashes tokens into `dim` buckets, then
 * L2-normalizes so cosine distance is well-defined. NOT a semantic model;
 * it exists so 11.2 can wire + test + bench the vector path before the real
 * model (11.3). Pure function of the input text.
 */
export class StubEmbedder implements TextEmbedder {
	readonly name = "stub-v1";
	readonly dim: number;

	constructor(dim: number = EMBEDDING_DIM) {
		this.dim = dim;
	}

	embed(text: string): Float32Array {
		const v = new Float32Array(this.dim);
		const tokens = tokenize(text);
		for (const token of tokens) {
			// Two independent hashes: one picks the bucket, one signs the
			// contribution — a hashing-trick feature map. Deterministic, no
			// model weights, no allocation beyond the output vector.
			const h = fnv1a(token);
			const bucket = h % this.dim;
			const sign = (fnv1a(`${token}#`) & 1) === 0 ? 1 : -1;
			v[bucket] = (v[bucket] ?? 0) + sign;
		}
		l2Normalize(v);
		return v;
	}
}

/** Lower-case word tokens (Unicode letters + numbers), mirroring the FTS5
 *  `unicode61` boundary used by the lexical indexer so the stub embeds the
 *  same token stream the lexical side indexes. */
function tokenize(text: string): string[] {
	if (typeof text !== "string" || text.length === 0) return [];
	return text
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((t) => t.length > 0);
}

/** 32-bit FNV-1a — a cheap, deterministic, dependency-free string hash.
 *  Returned as an unsigned 32-bit integer. */
function fnv1a(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		// 32-bit FNV prime multiply via shifts, kept in uint32 range.
		h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
	}
	return h >>> 0;
}

/** Scale `v` to unit L2 length in place. A zero vector (no tokens) is left
 *  as zeros — `queryNearest` against an all-zero query is the caller's
 *  concern, not the embedder's. */
function l2Normalize(v: Float32Array): void {
	let sum = 0;
	for (let i = 0; i < v.length; i++) {
		const x = v[i] ?? 0;
		sum += x * x;
	}
	if (sum === 0) return;
	const inv = 1 / Math.sqrt(sum);
	for (let i = 0; i < v.length; i++) {
		v[i] = (v[i] ?? 0) * inv;
	}
}
