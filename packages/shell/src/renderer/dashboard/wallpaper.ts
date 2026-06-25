/**
 * Resolve a `DashboardWallpaper` record (kind + value) to a CSS `background`
 * shorthand the renderer can apply. Pure code, unit-testable.
 *
 * The three kinds:
 *   - `solid`    — `value` is either a token name (`--color-background-primary`)
 *                   or any CSS color literal.
 *   - `gradient` — `value` is a full CSS gradient expression
 *                   (e.g. `linear-gradient(180deg, #111 0%, #333 100%)`).
 *   - `image`    — `value` is a URL (vault-relative or absolute); rendered as
 *                   `background-image: url(...)` with `cover` sizing.
 *
 * Returns a plain string so the caller can drop it into `style.background`
 * without a CSS object.
 */

import type { DashboardWallpaper } from "../../preload";

// Theme-independent fallback shown only before the first snapshot resolves on a
// vault with no cached wallpaper (see `usePersistedWallpaper`). Literal hex
// stops so it reads the same regardless of theme.
export const FALLBACK_WALLPAPER: DashboardWallpaper = {
	kind: "gradient",
	value:
		"radial-gradient(ellipse at 20% 10%, rgba(107, 115, 240, 0.16), transparent 50%), radial-gradient(ellipse at 80% 90%, rgba(107, 115, 240, 0.14), transparent 55%), linear-gradient(180deg, #14161b 0%, #2a2d33 100%)",
};

const WALLPAPER_URL_PREFIX = "brainstorm://wallpaper/";
const THUMB_SUFFIX = ".thumb.jpg";

/**
 * For an image wallpaper served from the vault's wallpaper store, derive the URL
 * of its pre-generated 320px thumbnail (minted on upload, backfilled on list).
 * Used as an instant blur-up underlay while the full-resolution file decodes.
 * Returns null for non-image kinds or images served from outside the store
 * (no thumbnail exists for those).
 */
export function wallpaperThumbUrl(wallpaper: DashboardWallpaper): string | null {
	if (wallpaper.kind !== "image") return null;
	if (!wallpaper.value.startsWith(WALLPAPER_URL_PREFIX)) return null;
	const fileName = decodeImageFileName(wallpaper.value.slice(WALLPAPER_URL_PREFIX.length));
	if (!fileName || fileName.endsWith(THUMB_SUFFIX)) return null;
	return `${WALLPAPER_URL_PREFIX}${encodeURIComponent(`${fileName}${THUMB_SUFFIX}`)}`;
}

function decodeImageFileName(encoded: string): string | null {
	try {
		return decodeURIComponent(encoded);
	} catch {
		return null;
	}
}

/** Resolve an image wallpaper's stored value to a loadable URL. Uploaded
 *  wallpapers carry a full `brainstorm://wallpaper/…` URL; the seeded default
 *  historically stored a bare filename, which resolves to the renderer root and
 *  404s (F-007). Treat any scheme-less value as a vault wallpaper filename and
 *  route it through the protocol that serves `<vault>/dashboard/wallpapers/`. */
export function resolveWallpaperImageSrc(value: string): string {
	return value.includes("://") ? value : `${WALLPAPER_URL_PREFIX}${encodeURIComponent(value)}`;
}

export function wallpaperBackground(wallpaper: DashboardWallpaper): string {
	switch (wallpaper.kind) {
		case "solid":
			return resolveColorValue(wallpaper.value);
		case "gradient":
			return wallpaper.value;
		case "image":
			return `center / cover no-repeat url(${escapeUrl(resolveWallpaperImageSrc(wallpaper.value))})`;
	}
}

function resolveColorValue(value: string): string {
	const trimmed = value.trim();
	if (trimmed.startsWith("--")) return `var(${trimmed})`;
	return trimmed;
}

function escapeUrl(url: string): string {
	return `"${url.replace(/"/g, '\\"')}"`;
}
