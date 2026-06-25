/**
 * Minimal SVG renderer. Draws nodes (circles + labels) and edges (lines)
 * given a layout snapshot. Reads alpha per node/edge so the history
 * scrubber can fade them in/out by adjusting opacity.
 *
 * Replaced by pixi.js at Stage 9.13.5 — until then this is the
 * plain-DOM minimum that proves the differentiator (multi-subject
 * pattern visible + history-scrubbed appearance order) is wired up.
 *
 * Zoom + LOD (level-of-detail) thresholds: below k=0.5 arrowheads
 * disappear; below k=1 node + edge labels disappear and discs replace
 * icon glyphs (icons and discs are mutually exclusive — a node draws
 * one or the other depending on `k`, never both stacked).
 */

import type { EntityRow, LinkRow } from "../logic/in-memory-graph";
import type { Icon } from "../types/icon";
import type { LayoutNode } from "./force-layout";
import { nodeLabel } from "./node-label";

const SVG_NS = "http://www.w3.org/2000/svg";

export type RenderNode = {
	id: string;
	entity: EntityRow;
	subjectName: string | null; // null = unmatched (background fade)
	color: string;
	radius: number;
	alpha: number;
	/** The entity's own universal icon (any kind), or null when it has
	 *  none. The Pixi renderer rasterises this to a real icon texture
	 *  (the per-object-icons mandate); the legacy SVG renderer can't load
	 *  textures so it falls back to `glyph`. */
	icon: Icon | null;
	/** Stable cache key for `icon` (its `iconKey`). Empty string when the
	 *  node has no icon. Lets the renderer key one texture per distinct
	 *  icon and detect "no icon" without re-deriving the key each frame. */
	iconSrc: string;
	/** Fallback glyph painted when no real icon texture is available — an
	 *  Emoji codepoint or a category glyph ("👤", "🏫") derived from the
	 *  type. Empty string means no glyph (plain disc). Type glyph is
	 *  fallback-only, never a substitute for the object's own icon. */
	glyph: string;
};

export type RenderEdge = {
	id: string;
	link: LinkRow;
	color: string;
	alpha: number;
};

/** Camera transform — `k` is the zoom level, `tx`/`ty` are the world
 *  translation in viewBox units. Identity is `{k:1, tx:0, ty:0}`. */
export type CameraTransform = {
	k: number;
	tx: number;
	ty: number;
};

export const IDENTITY_TRANSFORM: CameraTransform = { k: 1, tx: 0, ty: 0 };

/** Below this `k` value, arrowheads disappear. Arrowheads under
 *  half-zoom collapse into tiny squares at the edge tip and read as
 *  noise; the directionality cue isn't worth the visual cost. */
export const ARROW_HIDE_BELOW_K = 0.5;

/** Below this `k`, labels disappear and node icons swap for plain discs.
 *  Above this the graph is read close-up — icons + labels carry
 *  information; below it the user is surveying topology, where every
 *  label is clutter. */
export const DETAIL_THRESHOLD_K = 1;

/** Density cap: above this many visible nodes, labels hide even at full
 *  zoom. 150 labels on screen at once is the point where the eye stops
 *  being able to read any of them. The hovered + dragged node still
 *  keeps its label via the `forceLabel` exception below. */
export const MAX_LABELED_NODES = 150;

/** Hub labels at rest (F-048): even when the survey-zoom LOD hides all
 *  labels, the few highest-degree nodes keep theirs, so a zoomed-out graph
 *  reads as a *labelled* knowledge map (named hubs) rather than anonymous
 *  dots. Bounded to a small constant so the label-div count stays O(1)
 *  regardless of zoom or total node count — within the labels perf budget by
 *  construction (the density cap + per-frame work both stay flat). */
export const HUB_LABEL_COUNT = 8;

export type Snapshot = {
	nodes: ReadonlyMap<string, LayoutNode>;
	renderNodes: ReadonlyArray<RenderNode>;
	renderEdges: ReadonlyArray<RenderEdge>;
	width: number;
	height: number;
	/** Camera transform (zoom + pan). The renderer applies this to a single
	 *  `<g>` viewport wrapping all painted layers — one DOM write per frame
	 *  instead of per-node math. The viewport is also the surface the
	 *  pointer-to-world converter divides through (see `clientToWorld`). */
	transform: CameraTransform;
	/** Node currently under the pointer (or null when no hover). Used by
	 *  the renderer to draw the hover ring on the right disc — the dim/
	 *  fade of every OTHER node comes from `focusAlphaByNode`. */
	hoveredId: string | null;
	/** Per-node "focus alpha" — already animated by the app loop so the
	 *  renderer just multiplies it in. Nodes in the focus neighbourhood
	 *  approach 1.0; everyone else approaches `HOVER_DIM_ALPHA`. Each frame
	 *  the value lerps a bit closer, producing a smooth fade instead of a
	 *  binary jump. Missing entries default to 1.0. */
	focusAlphaByNode: ReadonlyMap<string, number>;
	/** Per-edge focus alpha — same idea as `focusAlphaByNode`. The app
	 *  layer derives this from the source/dest focus alphas so edges fade
	 *  in step with their endpoints. */
	focusAlphaByEdge: ReadonlyMap<string, number>;
	/** User toggle (Settings → Appearance → Titles). The SVG renderer
	 *  hides labels via a CSS rule on `data-show-labels="false"`; the Pixi
	 *  renderer reads this flag directly to skip the label overlay. */
	showLabels: boolean;
	/** User toggle (Settings → Appearance → Arrows). Same dual-path as
	 *  `showLabels` — CSS for SVG, snapshot-flag for Pixi. */
	showArrows: boolean;
};

/** Floor multiplier applied to a node/edge OUTSIDE the hovered
 *  neighbourhood. Low enough that the focus set pops; high enough that the
 *  context is still readable. Exported so the app layer can use the same
 *  constant as the lerp target. */
export const HOVER_DIM_ALPHA = 0.18;

/** Create the once-per-mount SVG scaffold. Returns handles into the
 *  four layers so subsequent `paint` calls can update them in place. The
 *  `hitsLayer` carries invisible larger circles that absorb pointer
 *  events so drag works on tiny visible nodes (visible radius scales
 *  with degree, but the click target stays generous regardless).
 *  All paint layers sit inside `viewport` — a single `<g>` whose
 *  `transform` attribute applies the camera (zoom + pan) once per frame. */
export function mountSvg(container: HTMLElement, width: number, height: number) {
	container.innerHTML = "";
	const svg = document.createElementNS(SVG_NS, "svg");
	svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
	svg.setAttribute("xmlns", SVG_NS);
	svg.setAttribute("preserveAspectRatio", "none");
	svg.setAttribute("class", "graph-canvas");
	const defs = document.createElementNS(SVG_NS, "defs");
	// Slim head — the arrow lands well under half the node diameter
	// (the head reads as a directional hint, not a stand-alone shape).
	// `viewBox` is 10×10 so the unit triangle scales with `markerWidth`.
	defs.innerHTML = `
		<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
			<path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
		</marker>
	`;
	svg.appendChild(defs);
	const viewport = document.createElementNS(SVG_NS, "g");
	viewport.setAttribute("class", "graph-canvas__viewport");
	const edgesLayer = document.createElementNS(SVG_NS, "g");
	edgesLayer.setAttribute("class", "graph-canvas__edges");
	const nodesLayer = document.createElementNS(SVG_NS, "g");
	nodesLayer.setAttribute("class", "graph-canvas__nodes");
	const glyphsLayer = document.createElementNS(SVG_NS, "g");
	glyphsLayer.setAttribute("class", "graph-canvas__glyphs");
	const labelsLayer = document.createElementNS(SVG_NS, "g");
	labelsLayer.setAttribute("class", "graph-canvas__labels");
	const hitsLayer = document.createElementNS(SVG_NS, "g");
	hitsLayer.setAttribute("class", "graph-canvas__hits");
	// Painter's order matters: edges first (lowest), then circles, then
	// glyphs inside circles, then labels, then transparent hit targets.
	// Without this the arrow head from `marker-end` ends up drawn beneath
	// the destination circle (or worse, over an adjacent circle when the
	// line passes close to it).
	viewport.appendChild(edgesLayer);
	viewport.appendChild(nodesLayer);
	viewport.appendChild(glyphsLayer);
	viewport.appendChild(labelsLayer);
	viewport.appendChild(hitsLayer);
	svg.appendChild(viewport);
	container.appendChild(svg);
	return { svg, viewport, edgesLayer, nodesLayer, glyphsLayer, labelsLayer, hitsLayer };
}

/** Update the SVG's viewBox in response to a container resize. The
 *  preserveAspectRatio is "none" so the SVG always fills the container —
 *  no letterbox — which keeps `clientX → viewBox` mapping exact. */
export function resizeSvg(handles: SvgHandles, width: number, height: number): void {
	handles.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
}

export type SvgHandles = ReturnType<typeof mountSvg>;

/** Paint a single frame. Cheap: O(nodes + edges) DOM updates per call.
 *  Diffs minimally — creates/removes <circle>, <line>, <text> as needed,
 *  positions update via `cx`/`cy`/`x1`/`y1`/`x2`/`y2` attributes.
 *  The camera transform is applied once on the viewport `<g>`, so paint
 *  cost is independent of zoom level. */
export function paint(handles: SvgHandles, snapshot: Snapshot): void {
	applyTransform(handles, snapshot.transform);
	syncEdges(handles.edgesLayer, snapshot);
	syncNodes(handles.nodesLayer, snapshot);
	syncGlyphs(handles.glyphsLayer, snapshot);
	syncLabels(handles.labelsLayer, snapshot);
	syncHits(handles.hitsLayer, snapshot);
}

function applyTransform(handles: SvgHandles, t: CameraTransform): void {
	handles.viewport.setAttribute("transform", `translate(${t.tx} ${t.ty}) scale(${t.k})`);
	const svgEl = handles.svg;
	// Mirror the LOD gate onto the SVG element so CSS can drop the arrow
	// marker and the labels layer in one declaration without the renderer
	// touching every line/text element. The data attrs are also a useful
	// debug surface — `inspect → data-zoom-level` in DevTools shows where
	// each threshold kicks in.
	svgEl.dataset.zoomLevel = String(t.k.toFixed(3));
	svgEl.dataset.lodArrows = t.k >= ARROW_HIDE_BELOW_K ? "true" : "false";
	svgEl.dataset.lodLabels = t.k >= DETAIL_THRESHOLD_K ? "true" : "false";
	svgEl.dataset.lodIcons = t.k >= DETAIL_THRESHOLD_K ? "true" : "false";
}

/** Minimum click radius for a node, in viewBox units. Nodes can be as
 *  small as ~2.5 (unmatched, no connections) — without a generous hit
 *  zone the user can't grab them. */
const MIN_HIT_RADIUS = 12;

/** Length of the marker-end arrow in viewBox units — must match the
 *  `markerWidth` set on the `#arrow` def above. */
const ARROW_HEAD_PX = 5;
/** Extra gap between the arrow tip and the node rim, in viewBox units.
 *  Without this the arrow visually fuses with the destination disc — a
 *  small breathing space reads as "connected to" rather than "drawn into". */
const ARROW_RIM_GAP_PX = 3;

function syncEdges(layer: SVGGElement, snapshot: Snapshot): void {
	const visibleByKey = new Map<string, RenderEdge>();
	for (const e of snapshot.renderEdges) visibleByKey.set(e.id, e);

	for (const child of Array.from(layer.children)) {
		const key = child.getAttribute("data-key");
		if (key && !visibleByKey.has(key)) layer.removeChild(child);
	}

	// Stroke width is divided by k so the rendered stroke stays visually
	// constant in screen-space as the camera zooms.
	const strokeWidth = 0.9 / Math.max(0.0001, snapshot.transform.k);

	for (const edge of snapshot.renderEdges) {
		const source = snapshot.nodes.get(edge.link.sourceEntityId);
		const dest = snapshot.nodes.get(edge.link.destEntityId);
		if (!source || !dest) continue;
		let line = layer.querySelector(`line[data-key="${edge.id}"]`) as SVGLineElement | null;
		if (!line) {
			line = document.createElementNS(SVG_NS, "line");
			line.setAttribute("data-key", edge.id);
			line.setAttribute("marker-end", "url(#arrow)");
			layer.appendChild(line);
		}
		const focusAlpha = snapshot.focusAlphaByEdge.get(edge.id) ?? 1;
		// Pull both endpoints back by the corresponding node radius so the
		// line + arrow head land at the rim, not inside the disc. The
		// source side just gets a small gap (no arrow there) so it doesn't
		// visually pierce the source node either.
		const dx = dest.x - source.x;
		const dy = dest.y - source.y;
		const dist = Math.hypot(dx, dy) || 1;
		const ux = dx / dist;
		const uy = dy / dist;
		const sourceTrim = source.radius + ARROW_RIM_GAP_PX;
		const destTrim = dest.radius + ARROW_HEAD_PX + ARROW_RIM_GAP_PX;
		const x1 = source.x + ux * sourceTrim;
		const y1 = source.y + uy * sourceTrim;
		const x2 = dest.x - ux * destTrim;
		const y2 = dest.y - uy * destTrim;
		// Skip degenerate edges (nodes overlap closer than the combined
		// trim) — the collision pass should prevent this in practice.
		if ((x2 - x1) * ux + (y2 - y1) * uy <= 0) {
			line.setAttribute("x1", String(source.x));
			line.setAttribute("y1", String(source.y));
			line.setAttribute("x2", String(source.x));
			line.setAttribute("y2", String(source.y));
		} else {
			line.setAttribute("x1", String(x1));
			line.setAttribute("y1", String(y1));
			line.setAttribute("x2", String(x2));
			line.setAttribute("y2", String(y2));
		}
		line.setAttribute("stroke", edge.color);
		line.setAttribute("stroke-width", String(strokeWidth));
		// `opacity` (not `stroke-opacity`) so the marker-end arrow inherits
		// the fade. `stroke-opacity` only fades the line itself; arrows kept
		// painting fully opaque during timeline reveal — visible as solid
		// black heads dangling on faded lines. Setting opacity on the
		// element fades stroke + marker as one unit.
		line.setAttribute("opacity", String(edge.alpha * focusAlpha));
	}
}

function syncNodes(layer: SVGGElement, snapshot: Snapshot): void {
	// At high zoom, the disc disappears in favour of the icon glyph
	// (when one is set on the node) — so an icon node draws disc XOR glyph,
	// never both stacked. Nodes without a glyph keep their disc at every
	// zoom level because the disc is the only visual they have.
	const detailZoom = snapshot.transform.k >= DETAIL_THRESHOLD_K;
	const visibleByKey = new Map<string, RenderNode>();
	for (const n of snapshot.renderNodes) {
		if (detailZoom && n.glyph) continue; // suppressed in favour of glyph
		visibleByKey.set(n.id, n);
	}
	for (const child of Array.from(layer.children)) {
		const key = child.getAttribute("data-key");
		if (key && !visibleByKey.has(key)) layer.removeChild(child);
	}
	const hovered = snapshot.hoveredId;
	const strokeWidth = 2 / Math.max(0.0001, snapshot.transform.k);
	for (const node of snapshot.renderNodes) {
		if (detailZoom && node.glyph) continue;
		const pos = snapshot.nodes.get(node.id);
		if (!pos) continue;
		let circle = layer.querySelector(`circle[data-key="${node.id}"]`) as SVGCircleElement | null;
		if (!circle) {
			circle = document.createElementNS(SVG_NS, "circle");
			circle.setAttribute("data-key", node.id);
			layer.appendChild(circle);
		}
		const focusAlpha = snapshot.focusAlphaByNode.get(node.id) ?? 1;
		const isHovered = node.id === hovered;
		circle.setAttribute("cx", String(pos.x));
		circle.setAttribute("cy", String(pos.y));
		circle.setAttribute("r", String(node.radius));
		// Solid-fill disc — one circle at full fill, no permanent stroke.
		// The hover ring is a thin outline that only shows when this node
		// is the hovered one. Single `opacity` on
		// the element fades fill + ring + glyph (the glyph below sits in a
		// separate layer; this circle's opacity drives the disc only). Using
		// `opacity` rather than `fill-opacity` so any future svg filter
		// (shadow, glow) honours the timeline reveal.
		circle.setAttribute("fill", node.color);
		circle.setAttribute("opacity", String(node.alpha * focusAlpha));
		if (isHovered) {
			circle.setAttribute("stroke", node.color);
			circle.setAttribute("stroke-width", String(strokeWidth));
			circle.setAttribute("stroke-opacity", "0.45");
		} else {
			circle.removeAttribute("stroke");
		}
		// Hits land on the overlay layer; the visible circle stays inert so
		// hover-shadowing doesn't change effective hit area.
		circle.setAttribute("pointer-events", "none");
	}
}

/** Paint the per-node glyph (emoji / type fallback) inside the disc.
 *  Centered both axes; size scales with the node radius so a hub icon is
 *  visibly bigger than a leaf. Empty `glyph` strings skip rendering — a
 *  node without an icon stays as a plain coloured disc. Glyphs only paint
 *  when the camera is at or above `DETAIL_THRESHOLD_K`; at lower zoom the
 *  disc layer takes over. */
function syncGlyphs(layer: SVGGElement, snapshot: Snapshot): void {
	const detailZoom = snapshot.transform.k >= DETAIL_THRESHOLD_K;
	const visibleByKey = new Map<string, RenderNode>();
	if (detailZoom) {
		for (const n of snapshot.renderNodes) {
			if (n.glyph) visibleByKey.set(n.id, n);
		}
	}
	for (const child of Array.from(layer.children)) {
		const key = child.getAttribute("data-key");
		if (key && !visibleByKey.has(key)) layer.removeChild(child);
	}
	if (!detailZoom) return;
	for (const node of snapshot.renderNodes) {
		if (!node.glyph) continue;
		const pos = snapshot.nodes.get(node.id);
		if (!pos) continue;
		let text = layer.querySelector(`text[data-key="${node.id}"]`) as SVGTextElement | null;
		if (!text) {
			text = document.createElementNS(SVG_NS, "text");
			text.setAttribute("data-key", node.id);
			text.setAttribute("text-anchor", "middle");
			text.setAttribute("dominant-baseline", "central");
			text.setAttribute("pointer-events", "none");
			layer.appendChild(text);
		}
		const focusAlpha = snapshot.focusAlphaByNode.get(node.id) ?? 1;
		// Emoji metrics put the glyph baseline a bit below the visual
		// centre — `dominant-baseline=central` + a +1px nudge places the
		// glyph optically centered inside the disc.
		text.setAttribute("x", String(pos.x));
		text.setAttribute("y", String(pos.y + 1));
		// Glyph drawn at 2× the radius — the disc-less glyph reads as the
		// node, so it needs to fill the same screen real-estate the disc
		// did at the disc-only zoom (`r * 1.3` was sized to fit *inside*
		// the disc; here the glyph IS the node). Emoji metrics underdraw
		// vs. font-size by ~25%, so 2× lands at a visually-equivalent disc
		// diameter without overflowing the hit zone.
		text.setAttribute("font-size", String(node.radius * 2));
		text.setAttribute("opacity", String(node.alpha * focusAlpha));
		text.textContent = node.glyph;
	}
}

function syncLabels(layer: SVGGElement, snapshot: Snapshot): void {
	// Labels only paint above the detail zoom AND under the density cap.
	// The hovered node is forced visible (the `forceLabel` exception)
	// so the user can always read what they're pointing at.
	const detailZoom = snapshot.transform.k >= DETAIL_THRESHOLD_K;
	const visibleNodeCount = snapshot.renderNodes.filter((n) => n.alpha > 0.05).length;
	const underDensityCap = visibleNodeCount <= MAX_LABELED_NODES;
	const showAllLabels = detailZoom && underDensityCap;

	const visibleByKey = new Map<string, RenderNode>();
	for (const n of snapshot.renderNodes) {
		if (showAllLabels || n.id === snapshot.hoveredId) visibleByKey.set(n.id, n);
	}
	for (const child of Array.from(layer.children)) {
		const key = child.getAttribute("data-key");
		if (key && !visibleByKey.has(key)) layer.removeChild(child);
	}
	if (!detailZoom && !snapshot.hoveredId) return;
	const hovered = snapshot.hoveredId;
	// Label font size shrinks with k so the label keeps a constant
	// screen-pixel size at any zoom. The base value (10px) is multiplied
	// by `1/k` so a k=2 label uses font-size 5 in world space, which
	// scales back to 10px after the viewport transform applies.
	const baseLabelSize = 10;
	const fontSize = baseLabelSize / Math.max(0.0001, snapshot.transform.k);
	const labelOffset = 4 / Math.max(0.0001, snapshot.transform.k);
	for (const node of snapshot.renderNodes) {
		if (!showAllLabels && node.id !== hovered) continue;
		const pos = snapshot.nodes.get(node.id);
		if (!pos) continue;
		let text = layer.querySelector(`text[data-key="${node.id}"]`) as SVGTextElement | null;
		if (!text) {
			text = document.createElementNS(SVG_NS, "text");
			text.setAttribute("data-key", node.id);
			text.setAttribute("text-anchor", "middle");
			// `hanging` anchors the text at its top edge — without this the
			// default alphabetic baseline puts the text's ascender inside
			// the disc and the label looks glued to the icon.
			text.setAttribute("dominant-baseline", "hanging");
			text.setAttribute("font-weight", "500");
			text.setAttribute("pointer-events", "none");
			layer.appendChild(text);
		}
		const focusAlpha = snapshot.focusAlphaByNode.get(node.id) ?? 1;
		text.setAttribute("x", String(pos.x));
		text.setAttribute("y", String(pos.y + node.radius + labelOffset));
		text.setAttribute("font-size", String(fontSize));
		text.setAttribute("fill", "currentColor");
		text.setAttribute("fill-opacity", String(Math.min(1, node.alpha + 0.1) * focusAlpha));
		text.setAttribute("font-weight", node.id === hovered ? "700" : "500");
		text.textContent = nodeLabel(node.entity);
	}
}

function syncHits(layer: SVGGElement, snapshot: Snapshot): void {
	const visibleByKey = new Map<string, RenderNode>();
	for (const n of snapshot.renderNodes) visibleByKey.set(n.id, n);
	for (const child of Array.from(layer.children)) {
		const key = child.getAttribute("data-key");
		if (key && !visibleByKey.has(key)) layer.removeChild(child);
	}
	// Hit radius is divided by k so the screen-space click target stays
	// the same regardless of zoom — at k=2 a 12px target becomes 6 in
	// world units, multiplied back to 12 by the viewport transform.
	const minHitWorld = MIN_HIT_RADIUS / Math.max(0.0001, snapshot.transform.k);
	for (const node of snapshot.renderNodes) {
		const pos = snapshot.nodes.get(node.id);
		if (!pos) continue;
		let circle = layer.querySelector(`circle[data-key="${node.id}"]`) as SVGCircleElement | null;
		if (!circle) {
			circle = document.createElementNS(SVG_NS, "circle");
			circle.setAttribute("data-key", node.id);
			circle.setAttribute("fill", "transparent");
			circle.setAttribute("stroke", "none");
			// `all` so the transparent fill still registers pointer events.
			circle.setAttribute("pointer-events", "all");
			layer.appendChild(circle);
		}
		circle.setAttribute("cx", String(pos.x));
		circle.setAttribute("cy", String(pos.y));
		circle.setAttribute("r", String(Math.max(minHitWorld, node.radius + 6)));
	}
}

/** Convert a clientX/clientY pair into world (pre-transform) coordinates.
 *  The viewport `<g>` applies `translate(tx,ty) scale(k)`, so the inverse
 *  is `(client → svg − tx) / k`. Used for hover/drag/click so pointer
 *  math stays correct as the user zooms or pans. */
export function clientToWorld(
	svg: SVGSVGElement,
	transform: CameraTransform,
	clientX: number,
	clientY: number,
): { x: number; y: number } {
	const rect = svg.getBoundingClientRect();
	const viewBox = svg.viewBox.baseVal;
	const vbWidth = viewBox.width || rect.width || 1;
	const vbHeight = viewBox.height || rect.height || 1;
	const sx = ((clientX - rect.left) / rect.width) * vbWidth;
	const sy = ((clientY - rect.top) / rect.height) * vbHeight;
	return {
		x: (sx - transform.tx) / transform.k,
		y: (sy - transform.ty) / transform.k,
	};
}

/** Convert a world coordinate (pre-transform) into screen client coords.
 *  Inverse of `clientToWorld` — needed by the hover-preview popover to
 *  position itself relative to a node's current screen position. */
export function worldToClient(
	svg: SVGSVGElement,
	transform: CameraTransform,
	worldX: number,
	worldY: number,
): { x: number; y: number } {
	const rect = svg.getBoundingClientRect();
	const viewBox = svg.viewBox.baseVal;
	const vbWidth = viewBox.width || rect.width || 1;
	const vbHeight = viewBox.height || rect.height || 1;
	const sx = worldX * transform.k + transform.tx;
	const sy = worldY * transform.k + transform.ty;
	return {
		x: rect.left + (sx / vbWidth) * rect.width,
		y: rect.top + (sy / vbHeight) * rect.height,
	};
}
