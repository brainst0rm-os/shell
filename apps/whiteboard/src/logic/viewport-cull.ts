/**
 * Viewport culling (9.17.20, OQ-WB-5 optimized-HTML) — the pure selector for
 * which nodes the DOM renderer should mount: only those whose world bounding box
 * intersects the visible viewport (expanded by a padding margin so a small pan
 * doesn't pop near-edge nodes in/out). Off-screen nodes are not in the DOM at
 * all, so a large board's per-node cost scales with what's *visible*, not the
 * total node count — the actual bottleneck (the camera-paint split, 9.17.21,
 * already removed per-frame layer rebuilds).
 *
 * Pure + renderer-agnostic (operates on world rects), so it is unit-testable and
 * survives any later static-layer canvas hybrid. The engine computes the world
 * viewport from its camera via {@link worldViewport} and feeds it here.
 */

/** A rectangle in world (board) coordinates. */
export type WorldRect = { minX: number; minY: number; maxX: number; maxY: number };

/** The minimal node shape culling reads (every `WhiteboardNode` satisfies it
 *  via `BaseNode`). Ink nodes pass their bounding box. */
export type CullNode = {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
};

/**
 * The ids of nodes whose world box intersects `viewport` expanded by `padding`
 * (world units). A node touching the padded viewport on any edge is kept.
 */
export function visibleNodeIds(
	nodes: readonly CullNode[],
	viewport: WorldRect,
	padding: number,
): Set<string> {
	const minX = viewport.minX - padding;
	const minY = viewport.minY - padding;
	const maxX = viewport.maxX + padding;
	const maxY = viewport.maxY + padding;
	const visible = new Set<string>();
	for (const node of nodes) {
		const right = node.x + node.width;
		const bottom = node.y + node.height;
		// Standard AABB overlap test (inclusive edges).
		if (node.x <= maxX && right >= minX && node.y <= maxY && bottom >= minY) {
			visible.add(node.id);
		}
	}
	return visible;
}

/**
 * The visible world rectangle for a camera that maps `world → screen` as
 * `screen = world * zoom + pan`. The screen viewport is `[0,0]‥[width,height]`;
 * its corners map back to world via `(screen - pan) / zoom`.
 */
export function worldViewport(
	camera: { panX: number; panY: number; zoom: number },
	size: { width: number; height: number },
): WorldRect {
	const z = camera.zoom || 1;
	return {
		minX: (0 - camera.panX) / z,
		minY: (0 - camera.panY) / z,
		maxX: (size.width - camera.panX) / z,
		maxY: (size.height - camera.panY) / z,
	};
}
