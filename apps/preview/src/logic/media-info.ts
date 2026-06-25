/**
 * Pure media-metadata formatting — shared by the audio + video
 * renderers (9.20.3) and exercised without a DOM. Keystone: these
 * survive any future swap to a Block-Protocol `preview-media` block.
 */

/** Human clock for a duration in seconds. `H:MM:SS` once an hour is
 *  reached, `M:SS` otherwise. Non-finite / negative input (a stream
 *  whose duration the browser reports as `Infinity` or `NaN` before
 *  metadata loads) degrades to an em dash so the inspector never shows
 *  `NaN:NaN`. */
export function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return "—";
	const total = Math.floor(seconds);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const ss = String(s).padStart(2, "0");
	if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
	return `${m}:${ss}`;
}

/** `1920 × 1080` for a video track. Returns `null` when either
 *  dimension is missing or non-positive (audio, or a frame the decoder
 *  hasn't sized yet) so the caller can omit the inspector row. */
export function formatResolution(width: number, height: number): string | null {
	if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
	if (width <= 0 || height <= 0) return null;
	return `${Math.round(width)} × ${Math.round(height)}`;
}

/** Strip the `type/` prefix and uppercase the subtype for a compact
 *  format chip (`video/mp4` → `MP4`, `audio/x-wav` → `X-WAV`). Falls
 *  back to the whole string when there's no slash. */
export function shortFormat(mime: string): string {
	const trimmed = mime.split(";")[0]?.trim() ?? "";
	if (trimmed.length === 0) return "";
	const slash = trimmed.indexOf("/");
	const sub = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
	return sub.toUpperCase();
}
