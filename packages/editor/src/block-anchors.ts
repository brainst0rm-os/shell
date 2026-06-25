/**
 * Durable block-anchor identity (B11.13) — the persistence + resolution
 * core behind "Copy link to block" links that survive reload.
 *
 * Lexical NodeKeys are session-scoped (regenerated on every hydrate), so a
 * `#block-<NodeKey>` link dies with its window. A *durable* anchor needs
 * (a) a persisted id and (b) a way to find the block again in a freshly
 * hydrated document whose keys are all new. The general solution — an id
 * field on every block node — needs Lexical NodeState (lexical ≥ 0.25, a
 * cross-app upgrade the plan explicitly defers), so this module takes the
 * anchoring approach annotation systems use over mutable text: each anchor
 * persists a content **fingerprint** (`{type, text, index}`) of its block,
 * and resolution re-finds the block by tiered matching (exact text →
 * prefix overlap for the edited/split case → type+position for text-less
 * decorator blocks). The fingerprint self-heals: every successful
 * resolution (and every session edit, via the plugin's update listener)
 * re-snapshots the entry, so an anchor follows its block across edits and
 * moves *as long as each session gets a chance to observe them* — the
 * documented "where reasonable" durability bound.
 *
 * Anchors persist in the note's own Y.Doc (a sibling `Y.Map` next to the
 * universal body root), so they sync with the body atomically and travel
 * cross-device without an entity-property write path. The store is typed
 * against a minimal structural `AnchorMapLike` that both `Y.Map` and a
 * plain `Map` satisfy, keeping this module dependency-free and headless-
 * testable. The session-side lifecycle (mint on copy, refresh on edit,
 * resolve on open) lives in `plugins/block-anchors-plugin.tsx`.
 */

/** Name of the sibling Y.Map on the entity's body doc that carries the
 *  anchor table. Protocol — persisted in vault docs; do not rename. */
export const BLOCK_ANCHORS_MAP_NAME = "blockAnchors";

/** Fingerprint text is capped so a huge block doesn't bloat the doc; the
 *  cap also bounds the matching work. 240 chars of prefix is plenty of
 *  discriminating signal for prose blocks. */
const MAX_FINGERPRINT_TEXT = 240;

/** Minimum shared-prefix length before a non-exact text match is trusted
 *  — guards against common sentence openers ("The ", "And ") binding an
 *  anchor to the wrong block. */
const MIN_PREFIX_OVERLAP = 8;

export type BlockAnchorEntry = {
	/** Lexical node type of the block at snapshot time ("paragraph",
	 *  "heading", "listitem", "image", …). */
	type: string;
	/** Normalised, capped text content at snapshot time. Empty for
	 *  text-less blocks (images, dividers) — those match by type+index. */
	text: string;
	/** Position among the document's blocks at snapshot time. A hint for
	 *  tie-breaking and the only signal for text-less blocks. */
	index: number;
};

/** A block's identity-relevant projection, extracted inside an editor
 *  read by the plugin. `key` is the session NodeKey. */
export type BlockSnapshot = BlockAnchorEntry & { key: string };

/** Cap + normalise a block's text for fingerprinting. */
export function fingerprintText(raw: string): string {
	return raw.replace(/\s+/g, " ").trim().slice(0, MAX_FINGERPRINT_TEXT);
}

/** Validate a persisted anchor entry read back off the Y.Map. Returns
 *  `null` for any malformed shape (a foreign writer, a future version)
 *  rather than throwing. */
export function coerceAnchorEntry(raw: unknown): BlockAnchorEntry | null {
	if (!raw || typeof raw !== "object") return null;
	const { type, text, index } = raw as Record<string, unknown>;
	if (typeof type !== "string" || typeof text !== "string") return null;
	if (typeof index !== "number" || !Number.isFinite(index)) return null;
	return { type, text, index };
}

export function anchorEntriesEqual(a: BlockAnchorEntry, b: BlockAnchorEntry): boolean {
	return a.type === b.type && a.text === b.text && a.index === b.index;
}

/** The structural slice of `Y.Map<unknown>` (and of a plain
 *  `Map<string, unknown>`) the store needs. */
export type AnchorMapLike = {
	get(key: string): unknown;
	set(key: string, value: unknown): void;
	forEach(callback: (value: unknown, key: string) => void): void;
};

export type BlockAnchorStore = {
	get(anchorId: string): BlockAnchorEntry | null;
	set(anchorId: string, entry: BlockAnchorEntry): void;
	/** Find an existing anchor whose entry equals `entry` exactly — lets
	 *  repeat copies of an unchanged block reuse one id instead of
	 *  growing the table. */
	findByEntry(entry: BlockAnchorEntry): string | null;
};

/** Store over any `AnchorMapLike` — a `Y.Map` in production (anchors sync
 *  with the body), a plain `Map` in tests / docs without a Y.Doc. Entries
 *  are written as plain JSON objects. */
export function createMapBlockAnchorStore(map: AnchorMapLike): BlockAnchorStore {
	return {
		get(anchorId) {
			return coerceAnchorEntry(map.get(anchorId));
		},
		set(anchorId, entry) {
			map.set(anchorId, { type: entry.type, text: entry.text, index: entry.index });
		},
		findByEntry(entry) {
			let found: string | null = null;
			map.forEach((value, key) => {
				if (found) return;
				const candidate = coerceAnchorEntry(value);
				if (candidate && anchorEntriesEqual(candidate, entry)) found = key;
			});
			return found;
		},
	};
}

function commonPrefixLength(a: string, b: string): number {
	const max = Math.min(a.length, b.length);
	let i = 0;
	while (i < max && a[i] === b[i]) i++;
	return i;
}

/**
 * Re-find an anchored block among the current document's blocks. Tiers:
 *
 *   1. Exact text match (non-empty text) — multiple hits tie-break on
 *      index distance (the closest survivor of a duplicate-paragraph doc).
 *      Type is deliberately NOT required: turn-into (paragraph → heading)
 *      preserves identity.
 *   2. Prefix overlap — the edited / split / extended case. Trusted only
 *      when the shared prefix is ≥ `MIN_PREFIX_OVERLAP` chars AND covers
 *      at least half of the shorter text. Best overlap wins; ties go to
 *      index distance.
 *   3. Text-less entries (decorator blocks) — same type, closest index.
 *
 * Returns the matched block's session key, or `null` (degrade to a plain
 * entity open) when nothing clears the bar.
 */
export function matchAnchorBlock(
	entry: BlockAnchorEntry,
	blocks: readonly BlockSnapshot[],
): string | null {
	if (entry.text.length > 0) {
		const exact = blocks.filter((b) => b.text === entry.text);
		const byIndex = (a: BlockSnapshot, b: BlockSnapshot) =>
			Math.abs(a.index - entry.index) - Math.abs(b.index - entry.index);
		if (exact.length > 0) return [...exact].sort(byIndex)[0]?.key ?? null;

		let best: { block: BlockSnapshot; overlap: number } | null = null;
		for (const block of blocks) {
			if (block.text.length === 0) continue;
			const overlap = commonPrefixLength(entry.text, block.text);
			const shorter = Math.min(entry.text.length, block.text.length);
			if (overlap < MIN_PREFIX_OVERLAP || overlap * 2 < shorter) continue;
			if (
				!best ||
				overlap > best.overlap ||
				(overlap === best.overlap && byIndex(block, best.block) < 0)
			) {
				best = { block, overlap };
			}
		}
		return best ? best.block.key : null;
	}

	const sameType = blocks.filter((b) => b.type === entry.type && b.text.length === 0);
	if (sameType.length === 0) return null;
	let closest = sameType[0];
	for (const block of sameType) {
		if (closest && Math.abs(block.index - entry.index) < Math.abs(closest.index - entry.index)) {
			closest = block;
		}
	}
	return closest?.key ?? null;
}
