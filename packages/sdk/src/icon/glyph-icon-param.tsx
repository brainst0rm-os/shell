/**
 * `glyphIconParam` — the menu twin of `createGlyphElement`. fancy-menus rows
 * paint icons from an `IconParam` whose `icon` is a Phosphor-compatible React
 * component; this turns an app-local `GlyphSpec` (the same viewBox + path data
 * apps already pass to `createGlyphElement` for their DOM chrome) into that
 * component, so an app's own glyph family — which isn't in the SDK `IconName`
 * registry — can feed a menu row without losing the glyph.
 *
 * Use `sdkMenuIcon(IconName)` for registry glyphs; reach for this only for the
 * genuinely app-specific chrome glyphs `createGlyphElement` already covers.
 * Build the param once per glyph (module scope) so the component identity is
 * stable across menu re-renders.
 */

import type { IconComponent, IconParam } from "@react-fancy-menus/core";
import type { GlyphSpec } from "./builtin-glyph";

// Memoised per spec object so the component identity is stable even when a
// caller invokes `glyphIconParam(spec)` inline per render — a fresh component
// each render would remount the icon subtree in the menu.
const CACHE = new WeakMap<GlyphSpec, IconParam>();

export function glyphIconParam(spec: GlyphSpec): IconParam {
	const cached = CACHE.get(spec);
	if (cached) return cached;
	const Glyph: IconComponent = ({ size = 16, className }) => {
		const stroke = spec.filled !== true;
		return (
			<svg
				viewBox={spec.viewBox}
				width={size}
				height={size}
				fill={spec.filled ? "currentColor" : "none"}
				{...(stroke
					? {
							stroke: "currentColor",
							strokeWidth: spec.strokeWidth ?? 1.5,
							strokeLinecap: "round" as const,
							strokeLinejoin: "round" as const,
						}
					: {})}
				aria-hidden="true"
				focusable="false"
				{...(className ? { className } : {})}
				{...(spec.innerMarkup !== undefined
					? { dangerouslySetInnerHTML: { __html: spec.innerMarkup } }
					: {})}
			>
				{spec.innerMarkup === undefined
					? (spec.paths ?? []).map((d, i) => <path key={`${i}:${d}`} d={d} />)
					: null}
			</svg>
		);
	};
	const param: IconParam = { icon: Glyph };
	CACHE.set(spec, param);
	return param;
}
