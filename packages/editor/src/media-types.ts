/**
 * Shared types for image / video blocks. Both decorators carry the
 * same alignment + width contract so the inspector can drive either
 * through one form.
 */

export enum MediaAlignment {
	Left = "left",
	Center = "center",
	Right = "right",
	Wide = "wide",
}

export const DEFAULT_MEDIA_ALIGNMENT = MediaAlignment.Center;

/** Percent of the content column the media occupies. `100` is the
 *  natural width; the inspector exposes quick presets at 25/50/75/100. */
export const DEFAULT_MEDIA_WIDTH_PERCENT = 100;
export const MIN_MEDIA_WIDTH_PERCENT = 10;
export const MAX_MEDIA_WIDTH_PERCENT = 100;

export function clampMediaWidth(value: number): number {
	if (!Number.isFinite(value)) return DEFAULT_MEDIA_WIDTH_PERCENT;
	if (value < MIN_MEDIA_WIDTH_PERCENT) return MIN_MEDIA_WIDTH_PERCENT;
	if (value > MAX_MEDIA_WIDTH_PERCENT) return MAX_MEDIA_WIDTH_PERCENT;
	return Math.round(value);
}

export function isMediaAlignment(value: unknown): value is MediaAlignment {
	return (
		value === MediaAlignment.Left ||
		value === MediaAlignment.Center ||
		value === MediaAlignment.Right ||
		value === MediaAlignment.Wide
	);
}
