/**
 * createIconElement — the pure-DOM twin of `<Icon>`. Plain-DOM apps (Files
 * / Tasks / Whiteboard / Bookmarks / …) paint the SAME interface glyph
 * without pulling React or a build-time SVG loader, mirroring how
 * `entity-icon.ts`'s `createEntityIconElement` is the imperative twin of
 * `<EntityIcon>`.
 *
 * Self-contained: builds a `<svg viewBox="0 0 256 256">` from the inlined
 * Phosphor markup in `./icon-glyphs.ts`, `fill="currentColor"` so it
 * inherits text colour like the React one. Unknown name → warn in dev,
 * return nothing (an empty hidden `<span>`) — matching the React `<Icon>`'s
 * `return null`.
 */

import { ICON_GLYPHS } from "./icon-glyphs";
import { resolveIconOverride } from "./icon-pack-runtime";
import { IconDirection, type IconName, IconWeight } from "./icon-registry";

export type CreateIconOptions = {
	/** Pixel size, applied to both width and height. Default 16. */
	size?: number;
	/** CSS colour; default inherits via `currentColor`. */
	color?: string;
	/** Phosphor weight. Default `regular`. */
	weight?: IconWeight | `${IconWeight}`;
	/** Whether the glyph carries inline-axis direction. `Inline` sets
	 *  `data-icon-direction="inline"` so the RTL mirror rule flips it; default
	 *  `Auto` leaves the glyph bidirectional. Stage 12.5. */
	direction?: IconDirection | `${IconDirection}`;
	className?: string;
};

const SVG_NS = "http://www.w3.org/2000/svg";

/** Build the icon as a standalone SVG element. The glyph markup is trusted
 *  (it ships in this package, generated from the Phosphor asset SVGs), so
 *  `innerHTML` here is not an injection surface — `name` only ever indexes
 *  the static registry, it is never interpolated into markup. */
function buildSvg(
	name: IconName | `${IconName}` | string,
	markup: string,
	options: CreateIconOptions,
): SVGSVGElement {
	const size = options.size ?? 16;
	const svg = document.createElementNS(SVG_NS, "svg");
	svg.setAttribute("xmlns", SVG_NS);
	svg.setAttribute("viewBox", "0 0 256 256");
	svg.setAttribute("width", `${size}`);
	svg.setAttribute("height", `${size}`);
	svg.setAttribute("fill", options.color ?? "currentColor");
	svg.setAttribute("aria-hidden", "true");
	svg.setAttribute("focusable", "false");
	svg.dataset.iconName = String(name);
	if (options.direction === IconDirection.Inline) {
		svg.dataset.iconDirection = "inline";
	}
	if (options.className) svg.setAttribute("class", options.className);
	svg.innerHTML = markup;
	return svg;
}

export function createIconElement(
	name: IconName | `${IconName}`,
	options: CreateIconOptions = {},
): SVGSVGElement | HTMLSpanElement {
	// An installed IconPack/v1 overrides this canonical name; default
	// (no pack) → null, so the built-in glyph path below is unchanged.
	const override = resolveIconOverride(String(name));
	if (override) return buildSvg(name, override, options);

	const weight = (options.weight ?? IconWeight.Regular) as IconWeight;
	const glyph = ICON_GLYPHS[name as IconName];
	const markup = glyph?.[weight] ?? glyph?.[IconWeight.Regular];

	if (!markup) {
		if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
			console.warn(`[icon] unknown icon name: ${String(name)}`);
		}
		const empty = document.createElement("span");
		empty.setAttribute("aria-hidden", "true");
		empty.dataset.iconName = String(name);
		empty.dataset.iconMissing = "true";
		return empty;
	}

	return buildSvg(name, markup, options);
}
