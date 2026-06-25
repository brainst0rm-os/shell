/**
 * `derive-shared-property-links` — pure keystone that emits **inferred**
 * edges between vault entities that share a vocabulary-bound property
 * value (Bookmarks with the same tag, DesignDocs in the same category,
 * OpenQuestions in the same section, etc.).
 *
 * Why a separate kind of edge: the structured links (`link-types`) encode
 * authored relations (Task→Project, Iteration→Stage). They paint the
 * skeleton. But most vault objects don't have an authored relation
 * to anything else, so the graph looks sparse. A *shared-property* edge
 * is a different signal — "these two things have something in common" —
 * and is dense by construction.
 *
 * Why vocabulary-bound only: a shared free-text scalar (`name`, `notes`)
 * would either never match or match arbitrarily; a shared
 * `status: "todo"` across 200 tasks is noise, not signal. Restricting to
 * properties that come from a small vocabulary (tags, sections,
 * categories, owner domains) keeps the derived graph readable. Per-rule
 * `maxGroupSize` caps the pairwise explosion if a vocabulary turns out
 * to be cardinality-skewed at runtime.
 *
 * Pair semantics: one edge per (rule, unordered-pair). If A and B share
 * BOTH "blue" and "fast" under the same `Bookmark.tags` rule, that's
 * still one edge — the link encodes "share something under this rule",
 * not "share this specific value". Multiple rules can paint multiple
 * edges between the same pair, which is fine and informative.
 *
 * Pure: no I/O, no clock. Deterministic for a given entity set so the
 * snapshot is stable across `vaultEntities.list()` calls.
 */

import type { VaultEntity, VaultLink } from "./vault-entities-service";

/** A single rule that scans entities and pairs them on a shared
 *  property value. `entityTypes` narrows the scan; `propertyPath` is a
 *  top-level key on the entity's `properties` bag; `arrayValued` lets a
 *  multi-valued field (`tags: ["a", "b"]`) contribute every value
 *  independently to the bucket. */
export type SharedPropertyRule = {
	/** Wire-shape link type emitted for matched pairs. Convention:
	 *  `brainstorm/shared-property/<Type>.<property>`. */
	linkType: string;
	/** Entity types this rule applies to. Same-type only — cross-type
	 *  shared-value edges are deliberately out of scope (they tend to
	 *  encode coincidence, not meaning). */
	entityTypes: ReadonlyArray<string>;
	/** Top-level property key on the entity's property bag. */
	propertyPath: string;
	/** True when the property is an array of strings (`tags[]`); false
	 *  when it's a single scalar string. */
	arrayValued: boolean;
	/** Buckets larger than this are dropped entirely — a vocabulary
	 *  value shared by 50 entities would emit `50*49/2 = 1225` edges and
	 *  drown the graph. The cap is per-bucket, not per-rule. */
	maxGroupSize: number;
};

/** The initial rule set — every property here is either a curated
 *  vocabulary (tags / categories) or a small enum (section / owner
 *  domain). Adding a rule is a one-line change and re-derives on the
 *  next `vaultEntities.list()`. */
export const DEFAULT_SHARED_PROPERTY_RULES: ReadonlyArray<SharedPropertyRule> = [
	{
		linkType: "brainstorm/shared-property/Bookmark.tags",
		entityTypes: ["brainstorm/Bookmark/v1"],
		propertyPath: "tags",
		arrayValued: true,
		maxGroupSize: 12,
	},
	{
		linkType: "brainstorm/shared-property/DesignDoc.category",
		entityTypes: ["brainstorm/DesignDoc/v1"],
		propertyPath: "category",
		arrayValued: false,
		maxGroupSize: 12,
	},
	{
		linkType: "brainstorm/shared-property/OpenQuestion.section",
		entityTypes: ["brainstorm/OpenQuestion/v1"],
		propertyPath: "section",
		arrayValued: false,
		maxGroupSize: 12,
	},
	{
		linkType: "brainstorm/shared-property/Stage.ownerDomain",
		entityTypes: ["brainstorm/Stage/v1"],
		propertyPath: "ownerDomain",
		arrayValued: false,
		maxGroupSize: 12,
	},
	// NB: `Person.company` is deliberately NOT a shared-property rule. Company
	// is a real `Company/v1` entity now (entities.db v5), so people connect
	// through a true `Person → Company` reference edge (catalog-driven), not an
	// inferred "two people typed the same string" pairwise link.
];

/** Read `props[propertyPath]` and return the string values it contributes
 *  under `rule`. `null`, missing, wrong-shape values yield `[]`. Blank /
 *  empty strings are dropped so they can't bucket-collide on `""`. */
function readPropertyValues(
	properties: Record<string, unknown>,
	rule: SharedPropertyRule,
): string[] {
	const raw = properties[rule.propertyPath];
	if (rule.arrayValued) {
		if (!Array.isArray(raw)) return [];
		const out: string[] = [];
		for (const v of raw) if (typeof v === "string" && v !== "") out.push(v);
		return out;
	}
	return typeof raw === "string" && raw !== "" ? [raw] : [];
}

/** Stable, deterministic edge id for an unordered pair under a rule. The
 *  pair is sorted lexicographically so the same {A, B} always produces
 *  the same id regardless of scan order. The rule's linkType is folded
 *  in so two different rules pairing the same entities get distinct
 *  ids. */
function pairEdgeId(linkType: string, a: string, b: string): string {
	const [lo, hi] = a < b ? [a, b] : [b, a];
	return `lnk_shared_${linkType}_${lo}_${hi}`;
}

/**
 * Project `entities` to the set of shared-property edges implied by
 * `rules`. Same-pair edges are emitted at most once per rule (so the
 * `Set<value>` per rule is sufficient — we don't multiply by how many
 * values the pair shares).
 *
 * Complexity: O(N * R + sum_over_buckets(K^2)) where the inner sum is
 * bounded by `maxGroupSize` per rule, so the total stays linear in N
 * for any realistic vault.
 */
export function deriveSharedPropertyLinks(
	entities: ReadonlyArray<VaultEntity>,
	rules: ReadonlyArray<SharedPropertyRule> = DEFAULT_SHARED_PROPERTY_RULES,
): VaultLink[] {
	const out: VaultLink[] = [];

	for (const rule of rules) {
		const typeSet = new Set(rule.entityTypes);
		const buckets = new Map<string, Set<string>>();

		for (const entity of entities) {
			if (!typeSet.has(entity.type)) continue;
			const values = readPropertyValues(entity.properties, rule);
			for (const v of values) {
				let bucket = buckets.get(v);
				if (!bucket) {
					bucket = new Set<string>();
					buckets.set(v, bucket);
				}
				bucket.add(entity.id);
			}
		}

		const emittedPairs = new Set<string>();
		// Sort by value so a pair sharing several values gets a deterministic
		// `detail` (the lexicographically-first shared value) regardless of the
		// order entities were scanned in.
		const sortedBuckets = [...buckets].sort((a, b) => a[0].localeCompare(b[0]));
		for (const [value, bucket] of sortedBuckets) {
			if (bucket.size < 2) continue;
			if (bucket.size > rule.maxGroupSize) continue;
			const ids = Array.from(bucket).sort();
			for (let i = 0; i < ids.length; i += 1) {
				const a = ids[i];
				if (a === undefined) continue;
				for (let j = i + 1; j < ids.length; j += 1) {
					const b = ids[j];
					if (b === undefined) continue;
					const pairKey = `${a}|${b}`;
					if (emittedPairs.has(pairKey)) continue;
					emittedPairs.add(pairKey);
					out.push({
						id: pairEdgeId(rule.linkType, a, b),
						sourceEntityId: a,
						destEntityId: b,
						linkType: rule.linkType,
						// The shared value that paired these two — surfaced as the
						// edge's human reason ("Shares tag: design"). When a pair
						// shares several values, the lexicographically-first wins
						// (buckets are sorted above); the edge encodes "share
						// something under this rule", not every value.
						detail: value,
						// Derived edges have no real creation time — they exist
						// as long as both endpoints share the value. `0` makes
						// the history scrubber treat them as "always there",
						// which matches their semantics (not an authored event).
						createdAt: 0,
						deletedAt: null,
					});
				}
			}
		}
	}

	return out;
}
