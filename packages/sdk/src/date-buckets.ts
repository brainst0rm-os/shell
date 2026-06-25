/**
 * Shared date-bucketing for "recently edited" lists. Every app that shows
 * a list of objects ordered by recency (Notes sidebar, Files list, future
 * surfaces) groups rows under date-section headers — Today / Yesterday /
 * Previous 7 days / Previous 30 days / then by calendar month — instead of
 * a per-row "edited 4m ago" caption. One bucketer so the section labels,
 * boundaries, and ordering are identical everywhere (DRY: this replaces
 * three ad-hoc per-app relative-time formatters).
 *
 * Pure: same `(ts, now, locale)` → same bucket. No React, no DOM. The
 * caller wraps the four fixed labels in its own `t()`; month labels are
 * locale-formatted here (a date, not a translatable string) the same way
 * the rest of the app renders absolute dates.
 */

export enum DateBucketKind {
	Today = "today",
	Yesterday = "yesterday",
	Last7 = "last7",
	Last30 = "last30",
	/** Anything older than 30 days, grouped per calendar month — the
	 *  label is the locale-formatted month + year (e.g. "April 2026"). */
	Month = "month",
}

/** The four fixed labels. App-agnostic English defaults; a localised
 *  caller passes a `Partial` of just the keys it translates (same pattern
 *  as `DEFAULT_NAV_LABELS` / object-menu chrome). Month labels are not
 *  here — they are a formatted date, not a phrase. */
export type DateBucketLabels = {
	today: string;
	yesterday: string;
	last7: string;
	last30: string;
};

export const DEFAULT_DATE_BUCKET_LABELS: DateBucketLabels = {
	today: "Today",
	yesterday: "Yesterday",
	last7: "Previous 7 days",
	last30: "Previous 30 days",
};

export type DateBucket = {
	/** Stable per-bucket id — section-header de-dup + virtualiser keys.
	 *  Fixed buckets use their kind; month buckets use `m-<y>-<m>`. */
	key: string;
	kind: DateBucketKind;
	/** Header text (already localised / formatted). */
	label: string;
};

export type DateBucketOptions = {
	/** Defaults to `Date.now()` — injectable so callers/tests are pure. */
	now?: number;
	labels?: Partial<DateBucketLabels>;
	/** BCP-47 tag for the month label. Defaults to the host locale;
	 *  tests pass an explicit tag for determinism. */
	locale?: string;
};

const DAY_MS = 86_400_000;

/** Local midnight for `ts` — bucket boundaries are calendar days in the
 *  viewer's timezone, not fixed 24h windows (so "Yesterday" flips at
 *  midnight, matching user expectation). */
function startOfLocalDay(ts: number): number {
	const d = new Date(ts);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

export function dateBucket(ts: number, options: DateBucketOptions = {}): DateBucket {
	const now = options.now ?? Date.now();
	const labels = { ...DEFAULT_DATE_BUCKET_LABELS, ...options.labels };
	const todayStart = startOfLocalDay(now);

	// Clamp future timestamps (clock skew / "saved a moment ago") to Today
	// rather than letting them fall through every boundary.
	if (ts >= todayStart) {
		return { key: DateBucketKind.Today, kind: DateBucketKind.Today, label: labels.today };
	}
	if (ts >= todayStart - DAY_MS) {
		return {
			key: DateBucketKind.Yesterday,
			kind: DateBucketKind.Yesterday,
			label: labels.yesterday,
		};
	}
	if (ts >= todayStart - 7 * DAY_MS) {
		return { key: DateBucketKind.Last7, kind: DateBucketKind.Last7, label: labels.last7 };
	}
	if (ts >= todayStart - 30 * DAY_MS) {
		return { key: DateBucketKind.Last30, kind: DateBucketKind.Last30, label: labels.last30 };
	}
	const d = new Date(ts);
	return {
		key: `m-${d.getFullYear()}-${d.getMonth()}`,
		kind: DateBucketKind.Month,
		label: d.toLocaleDateString(options.locale, { month: "long", year: "numeric" }),
	};
}

export type DateBucketGroup<T> = { bucket: DateBucket; items: T[] };

/**
 * Partition `items` into ordered date-section groups. Input order is
 * preserved within and across groups: callers pass a list already sorted
 * most-recent-first, so the emitted groups come out Today → … → oldest
 * month with no extra sort here (stable + deterministic).
 */
export function groupByDateBucket<T>(
	items: readonly T[],
	getTimestamp: (item: T) => number,
	options: DateBucketOptions = {},
): DateBucketGroup<T>[] {
	const groups: DateBucketGroup<T>[] = [];
	const byKey = new Map<string, DateBucketGroup<T>>();
	for (const item of items) {
		const bucket = dateBucket(getTimestamp(item), options);
		const existing = byKey.get(bucket.key);
		if (existing) {
			existing.items.push(item);
			continue;
		}
		const group: DateBucketGroup<T> = { bucket, items: [item] };
		byKey.set(bucket.key, group);
		groups.push(group);
	}
	return groups;
}
