/**
 * 9.13.10d (unblocked half) — bucket the loaded graph's creation
 * timestamps into a fixed-width histogram for the scrubber.
 *
 * The history scrubber replays the *already-loaded* in-memory graph, so
 * "when did activity happen" is a pure function of the entities' + links'
 * `createdAt` over the timeline range — no live `entities.subscribe`
 * channel needed (that stays the genuinely dep-gated tail). This is the
 * keystone the density strip + the revealed-so-far split render off;
 * pure + deterministic, unit-tested without the canvas.
 */

/**
 * Count timestamps into `bucketCount` equal-width buckets spanning
 * `[min, max]`. Timestamps are clamped into range (a backfilled legacy
 * value at the floor still counts in bucket 0). Degenerate inputs never
 * throw: `bucketCount <= 0` → `[]`; an empty input → all-zero buckets;
 * `min >= max` (one instant, or a single-event graph) → every timestamp
 * in the last bucket so the strip reads "all happened at once" rather
 * than dividing by zero.
 */
export function bucketTimestamps(
	timestamps: readonly number[],
	min: number,
	max: number,
	bucketCount: number,
): number[] {
	if (!Number.isFinite(bucketCount) || bucketCount <= 0) return [];
	const n = Math.floor(bucketCount);
	const buckets = new Array<number>(n).fill(0);
	const span = max - min;
	for (const t of timestamps) {
		if (!Number.isFinite(t)) continue;
		let idx: number;
		if (span <= 0) {
			idx = n - 1;
		} else {
			const clamped = t < min ? min : t > max ? max : t;
			idx = Math.floor(((clamped - min) / span) * n);
			if (idx >= n) idx = n - 1; // t === max lands in the last bucket
			if (idx < 0) idx = 0;
		}
		buckets[idx] = (buckets[idx] ?? 0) + 1;
	}
	return buckets;
}

/**
 * The bucket index a cutoff falls in — drives the "revealed so far"
 * split of the density strip. `null` cutoff (history off) → every
 * bucket is revealed, so the last index. Same clamping/degenerate rules
 * as `bucketTimestamps` so the strip and the counts always agree.
 */
export function cutoffBucketIndex(
	cutoffAt: number | null,
	min: number,
	max: number,
	bucketCount: number,
): number {
	if (!Number.isFinite(bucketCount) || bucketCount <= 0) return -1;
	const n = Math.floor(bucketCount);
	if (cutoffAt === null || !Number.isFinite(cutoffAt)) return n - 1;
	const span = max - min;
	if (span <= 0) return n - 1;
	const clamped = cutoffAt < min ? min : cutoffAt > max ? max : cutoffAt;
	let idx = Math.floor(((clamped - min) / span) * n);
	if (idx >= n) idx = n - 1;
	if (idx < 0) idx = 0;
	return idx;
}
