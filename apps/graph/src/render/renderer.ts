/**
 * Renderer abstraction — a uniform interface both `svg-renderer.ts`
 * (legacy preview path) and `pixi-renderer.ts` (production path,
 * iteration 9.13.5) satisfy. `app.ts` calls only this surface, so
 * swapping renderers is a single boot-time decision.
 *
 * The shape is intentionally small. Per-frame work goes through
 * `paint`; per-resize work through `resize`; pointer hit-testing through
 * `pickNode` (so the SVG path can keep its DOM-`closest` shortcut while
 * the Pixi path uses a position scan); world-to-screen math through
 * `nodeToClient` (so the hover-preview popover positions correctly
 * under either renderer).
 *
 * The `kind` discriminator is occasionally useful (e.g. binding pointer
 * events on the SVG vs Canvas element when only one is in play), but
 * most call sites read `renderer.element` and don't care.
 */

import {
	destroyPixi,
	mountPixi,
	paintPixi,
	nodeWorldToClient as pixiNodeWorldToClient,
	pickNodeAt as pixiPickNodeAt,
	resizePixi,
} from "./pixi-renderer";
import {
	type CameraTransform,
	type Snapshot,
	clientToWorld,
	mountSvg,
	paint as paintSvg,
	resizeSvg,
	worldToClient,
} from "./svg-renderer";

/** Discriminator on which renderer was mounted. Used in the rare cases
 *  where event handlers need to do renderer-specific routing (most code
 *  paths are renderer-agnostic and read `element` / call `paint` / etc). */
export enum RendererKind {
	Svg = "svg",
	Pixi = "pixi",
}

export type Renderer = {
	kind: RendererKind;
	/** The DOM element where pointer events land — `<svg>` for SVG,
	 *  `<canvas>` for Pixi. Typed `HTMLElement` because every call site
	 *  uses only the shared surface (`addEventListener`,
	 *  `getBoundingClientRect`, `dataset`); the SVG branch casts at the
	 *  one mount boundary rather than forcing a union here (a union
	 *  collapses TS's typed `addEventListener` overloads). */
	element: HTMLElement;
	/** Paint a frame. `geometryDirty` (default true) tells the renderer
	 *  whether world-space geometry changed since the last paint; on a pure
	 *  zoom/pan it is false, letting the Pixi path skip the redundant edge
	 *  `Graphics` rebuild (the camera transform moves the cached buffer for
	 *  free). The SVG path ignores it — it re-syncs every frame regardless. */
	paint(snapshot: Snapshot, geometryDirty?: boolean): void;
	resize(width: number, height: number): void;
	/** Resolve a screen point to the node id under it (or null). The
	 *  SVG renderer can lean on `Element.closest`; Pixi does a linear
	 *  scan. The snapshot is required because hit math depends on
	 *  current node positions + radii. */
	pickNode(snapshot: Snapshot, clientX: number, clientY: number): string | null;
	/** World → screen for a single point. Used by the hover-preview
	 *  popover to follow the hovered node across pan/zoom. */
	nodeToClient(transform: CameraTransform, worldX: number, worldY: number): { x: number; y: number };
	/** Screen → world. Used by the node-drag handler to translate
	 *  pointer moves into world-space `fx/fy` updates. */
	clientToWorldPoint(
		transform: CameraTransform,
		clientX: number,
		clientY: number,
	): { x: number; y: number };
	/** Release all renderer resources (GPU textures, the Pixi `Application`,
	 *  the canvas). Called once on window close so the renderer process
	 *  isn't torn down with a live WebGL context + thousands of sprites
	 *  still resident. Idempotent. */
	destroy(): void;
};

/** Mount the requested renderer under `container`. Pixi's mount is async
 *  (Pixi 8 initialises GPU resources asynchronously); SVG is sync but
 *  this function returns a Promise either way so call sites don't fork
 *  on renderer kind. */
export async function mountRenderer(
	kind: RendererKind,
	container: HTMLElement,
	width: number,
	height: number,
	/** Invoked when an async resource (icon texture) resolves, so a
	 *  change-gated app loop knows to repaint. No-op for the SVG path. */
	onInvalidate: () => void = () => {},
): Promise<Renderer> {
	if (kind === RendererKind.Pixi) {
		const handles = await mountPixi(container, width, height, onInvalidate);
		return {
			kind: RendererKind.Pixi,
			element: handles.canvas,
			paint: (snapshot, geometryDirty) => paintPixi(handles, snapshot, geometryDirty),
			resize: (w, h) => resizePixi(handles, w, h),
			pickNode: (snapshot, clientX, clientY) =>
				pixiPickNodeAt(handles, snapshot.transform, snapshot, clientX, clientY),
			nodeToClient: (transform, worldX, worldY) =>
				pixiNodeWorldToClient(handles, transform, worldX, worldY),
			clientToWorldPoint: (transform, clientX, clientY) => {
				const rect = handles.canvas.getBoundingClientRect();
				const sx = clientX - rect.left;
				const sy = clientY - rect.top;
				return {
					x: (sx - transform.tx) / transform.k,
					y: (sy - transform.ty) / transform.k,
				};
			},
			destroy: () => destroyPixi(handles),
		};
	}
	const handles = mountSvg(container, width, height);
	return {
		kind: RendererKind.Svg,
		// SVGSVGElement satisfies the shared `element` surface (events,
		// getBoundingClientRect, dataset) but is not an HTMLElement; the
		// erasure is deliberate and documented on `Renderer.element`.
		element: handles.svg as unknown as HTMLElement,
		paint: (snapshot) => paintSvg(handles, snapshot),
		resize: (w, h) => resizeSvg(handles, w, h),
		pickNode: (_snapshot, clientX, clientY) => {
			// The browser already builds the hit-test tree for the SVG —
			// `elementFromPoint` walks it. We then map back to our
			// `data-key` attribute.
			const el = document.elementFromPoint(clientX, clientY);
			const circle = el?.closest("circle[data-key]");
			return circle?.getAttribute("data-key") ?? null;
		},
		nodeToClient: (transform, worldX, worldY) =>
			worldToClient(handles.svg, transform, worldX, worldY),
		clientToWorldPoint: (transform, clientX, clientY) =>
			clientToWorld(handles.svg, transform, clientX, clientY),
		destroy: () => {
			handles.svg.remove();
		},
	};
}

/** Decide which renderer to use at boot. Hierarchy:
 *   1. Explicit override via the `?renderer=svg|pixi` query string.
 *   2. Saved preference (future — wired through persistedState).
 *   3. Default: Pixi (production path, handles thousands of nodes). */
export function chooseRenderer(): RendererKind {
	if (typeof window === "undefined") return RendererKind.Pixi;
	const search = new URLSearchParams(window.location.search);
	const override = search.get("renderer");
	if (override === "svg") return RendererKind.Svg;
	if (override === "pixi") return RendererKind.Pixi;
	return RendererKind.Pixi;
}
