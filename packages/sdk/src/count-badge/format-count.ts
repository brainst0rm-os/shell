/**
 * Pure formatter shared by the React `<CountBadge>` and the imperative
 * `createCountBadge` so the cap rule (`max` → `"N+"`) lives in exactly one
 * place. No DOM, no React.
 */

/** Visual emphasis. Enum, not a bare literal, per the no-string-discriminator
 *  convention. */
export enum CountBadgeTone {
	/** The resting soft-grey pill. The common case. */
	Neutral = "neutral",
	/** Accent-tinted — the badge on an active / selected row. */
	Accent = "accent",
}

/** `count` → the string shown in the pill. `max` caps the display so a huge
 *  bucket renders as `"99+"` instead of blowing out the row width; the raw
 *  count still lands in `data-count` for styling + assistive tech. */
export function formatCount(count: number, max?: number): string {
	if (typeof max === "number" && Number.isFinite(max) && count > max) return `${max}+`;
	return String(count);
}

/** The class string for a badge at a given tone (+ optional extra classes). */
export function countBadgeClassName(tone: CountBadgeTone, extra?: string): string {
	const base =
		tone === CountBadgeTone.Accent ? "bs-count-badge bs-count-badge--accent" : "bs-count-badge";
	return extra ? `${base} ${extra}` : base;
}
