/**
 * Icon → image-source layer. The graph renders nodes as GPU sprites, so
 * every kind of universal icon (Emoji / Image / Pack) has to become a
 * single rasterisable `HTMLImageElement` the Pixi layer can turn into a
 * texture. This module is the only place that knows how each kind maps
 * to pixels; the renderer just asks for "the image for this icon" and
 * caches the resulting texture by `iconKey`.
 *
 * This mirrors the *shape* of the host→worker image hand-off other graph
 * engines use (a stable src key + a decoded bitmap, decoupled from the
 * draw loop) but shares no code with any of them — the kinds, the Phosphor
 * asset path and the recolouring are all Brainstorm's own universal-icon
 * model (docs/foundations/39-universal-icons.md).
 *
 *   - Emoji → the bundled WebP the shell serves (`brainstorm://emoji/…`).
 *   - Image → the stored URL as-is.
 *   - Pack  → the Phosphor `regular` SVG asset, recoloured to the node's
 *             colour and wrapped as a data URL.
 *
 * Pack SVGs are pulled lazily via `import.meta.glob`: the matched files
 * stay out of the entry bundle (only the handful actually drawn are ever
 * fetched), keeping the size-limit budget intact while avoiding a React
 * dependency in this non-React app.
 */

import { type Icon, IconKind } from "../types/icon";
import { emojiUrl } from "./emoji-url";

const PHOSPHOR_PACK_PREFIX = "phosphor/";

/** Lazy handles to every Phosphor `regular` SVG. Non-eager so they become
 *  individual on-demand chunks rather than inflating the entry bundle; the
 *  glob path is relative to this file and `@phosphor-icons/core` resolves
 *  under `apps/graph`. Re-keyed once by bare icon name so per-icon lookup
 *  is O(1) (the glob keys are full module paths). */
const phosphorByName: ReadonlyMap<string, () => Promise<string>> = new Map(
	Object.entries(
		import.meta.glob<string>("../../node_modules/@phosphor-icons/core/assets/regular/*.svg", {
			query: "?raw",
			import: "default",
		}),
	).map(([path, loader]) => [path.slice(path.lastIndexOf("/") + 1, -".svg".length), loader]),
);

/** Stable identity key for a resolved icon (kind + value). Pack's
 *  recolour isn't folded in here — the renderer composes the final
 *  texture-cache key as `iconSrc|colour` because the same glyph on two
 *  subject colours is two bitmaps. Null when the entity carries no icon. */
export function iconKey(icon: Icon | null): string | null {
	if (!icon) return null;
	switch (icon.kind) {
		case IconKind.Emoji:
			return `emoji:${icon.value}`;
		case IconKind.Image:
			return `image:${icon.value}`;
		case IconKind.Pack:
			return `pack:${icon.value}`;
	}
}

/** PascalCase / camelCase → phosphor's kebab asset filename. The picker
 *  stores `phosphor/<kebab-name>` today, but tolerate a stored pascal
 *  name so a future picker change doesn't silently drop every icon. */
function phosphorAssetName(packValue: string): string | null {
	if (!packValue.startsWith(PHOSPHOR_PACK_PREFIX)) return null;
	const raw = packValue.slice(PHOSPHOR_PACK_PREFIX.length);
	if (!raw) return null;
	return raw
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.replace(/[\s_]+/g, "-")
		.toLowerCase();
}

function loadPhosphorSvg(name: string): Promise<string> | null {
	const loader = phosphorByName.get(name);
	return loader ? loader() : null;
}

/** Allow only a strict CSS-colour shape before it's interpolated into SVG
 *  markup. `icon.color` is loosely-typed vault data; `loadUrl` rasterises
 *  through `<img>` so script can't execute, but an unvalidated value could
 *  still inject markup/attributes into the recoloured SVG. Anything that
 *  isn't a hex / rgb(a) / hsl(a) / bare keyword falls back to the disc
 *  colour the renderer already passes for this node. */
const CSS_COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d.,%\s/]+\)|hsla?\([\d.,%\s/]+\)|[a-zA-Z]+)$/;

function safeColor(color: string): string | null {
	const c = color.trim();
	return CSS_COLOR.test(c) ? c : null;
}

function decode(img: HTMLImageElement): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error("icon image failed to load"));
	});
}

function loadUrl(url: string): Promise<HTMLImageElement> {
	const img = new Image();
	// Pixi uploads these via `texImage2D`; WebGL rejects a texture sourced
	// from an `<img>` the browser considers cross-origin-tainted. The
	// emoji glyphs come from the `brainstorm://emoji/…` privileged scheme
	// (registered `corsEnabled: true`), so we MUST opt the element into
	// CORS — without it every emoji icon decodes but throws
	// `SecurityError` at GPU upload and no icon ever paints. http(s)
	// (remote Image-kind icons) need it for the same reason; `data:`
	// (recoloured Pack SVGs) is same-origin and must NOT set it.
	if (/^https?:/.test(url) || url.startsWith("brainstorm:")) {
		img.crossOrigin = "anonymous";
	}
	img.decoding = "async";
	const done = decode(img);
	img.src = url;
	return done;
}

/** Recolour a Phosphor SVG (its paths are `fill="currentColor"`) to the
 *  node colour and hand it back as a data URL `Image`. */
async function loadPack(packValue: string, color: string): Promise<HTMLImageElement> {
	const name = phosphorAssetName(packValue);
	if (!name) throw new Error(`unrecognised pack icon: ${packValue}`);
	const svgLoad = loadPhosphorSvg(name);
	if (!svgLoad) throw new Error(`phosphor asset not found: ${name}`);
	const svg = await svgLoad;
	// Validate before substitution — `color` may carry `icon.color` from
	// loosely-typed vault data. Fall back to a neutral grey, never raw.
	const recoloured = svg.replace(/currentColor/g, safeColor(color) ?? "#888888");
	return loadUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(recoloured)}`);
}

/** Resolve an icon to a decoded image ready for `Texture.from`. Rejects
 *  if the asset can't be produced; callers fall back to the plain disc. */
export function loadIconImage(icon: Icon, color: string): Promise<HTMLImageElement> {
	switch (icon.kind) {
		case IconKind.Emoji:
			return loadUrl(emojiUrl(icon.value));
		case IconKind.Image:
			return loadUrl(icon.value);
		case IconKind.Pack:
			return loadPack(icon.value, icon.color ?? color);
	}
}
