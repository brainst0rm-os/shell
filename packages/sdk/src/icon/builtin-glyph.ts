/**
 * `createGlyphElement` — the shared inline-SVG builder for app-local "chrome
 * glyph" stopgaps: the small set of icons an app's toolbar/sidebar needs that
 * the generated `IconName` registry doesn't yet expose (prev/next chevrons,
 * view-kind markers, canvas tools, Inbox/Upcoming, …).
 *
 * Every app (Calendar, Journal, Preview, Graph, Whiteboard, Database, Tasks)
 * had re-typed the identical `document.createElementNS` boilerplate — same
 * `currentColor`, `aria-hidden`, `focusable`, optional title/class. This is
 * that builder, once. Apps keep their own glyph PATH data and metrics
 * (viewBox / stroke weight / fill-vs-stroke) and pass them as a `GlyphSpec`,
 * so the rendered markup is byte-identical to the hand-rolled version.
 *
 * Prefer `createIconElement(IconName.X)` for any glyph the registry already
 * has; reach for this only for genuinely app-specific chrome glyphs (and
 * flag persistent gaps upstream so they can graduate into the registry).
 */

const SVG_NS = "http://www.w3.org/2000/svg";

export type GlyphSpec = {
	/** SVG `viewBox` — e.g. `"0 0 16 16"` (hand-drawn) or `"0 0 256 256"`
	 *  (Phosphor-grid). */
	viewBox: string;
	/** One or more `<path d="…">` strings. Use this OR `innerMarkup`. */
	paths?: readonly string[];
	/** Raw inner SVG markup (e.g. a Phosphor asset's body), as an
	 *  alternative to `paths` for multi-element glyphs. */
	innerMarkup?: string;
	/** Stroke weight for stroked glyphs (also sets `fill="none"`,
	 *  round line caps/joins). Default `1.5`. Ignored when `filled`. */
	strokeWidth?: number;
	/** Filled glyph (`fill="currentColor"`, no stroke) — for solid Phosphor
	 *  bodies. */
	filled?: boolean;
};

export type GlyphOptions = {
	/** Rendered px (width = height). Default 16. */
	size?: number;
	className?: string;
	/** When set, the glyph is meaningful: `role="img"` + a `<title>`. */
	title?: string;
	/** Mirror under `dir="rtl"` via `data-icon-direction="inline"` (for
	 *  directional glyphs like chevrons). */
	inlineAxis?: boolean;
};

export function createGlyphElement(spec: GlyphSpec, options: GlyphOptions = {}): SVGSVGElement {
	const size = options.size ?? 16;
	const svg = document.createElementNS(SVG_NS, "svg");
	svg.setAttribute("viewBox", spec.viewBox);
	svg.setAttribute("width", String(size));
	svg.setAttribute("height", String(size));
	if (spec.filled) {
		svg.setAttribute("fill", "currentColor");
	} else {
		svg.setAttribute("fill", "none");
		svg.setAttribute("stroke", "currentColor");
		svg.setAttribute("stroke-width", String(spec.strokeWidth ?? 1.5));
		svg.setAttribute("stroke-linecap", "round");
		svg.setAttribute("stroke-linejoin", "round");
	}
	svg.setAttribute("aria-hidden", options.title ? "false" : "true");
	svg.setAttribute("focusable", "false");
	if (options.inlineAxis) svg.setAttribute("data-icon-direction", "inline");
	if (options.className) svg.setAttribute("class", options.className);
	if (options.title) {
		svg.setAttribute("role", "img");
		const titleEl = document.createElementNS(SVG_NS, "title");
		titleEl.textContent = options.title;
		svg.appendChild(titleEl);
	}
	if (spec.innerMarkup !== undefined) {
		svg.insertAdjacentHTML("beforeend", spec.innerMarkup);
	} else {
		for (const d of spec.paths ?? []) {
			const path = document.createElementNS(SVG_NS, "path");
			path.setAttribute("d", d);
			svg.appendChild(path);
		}
	}
	return svg;
}
