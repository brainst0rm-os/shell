/**
 * Align & distribute (9.17.14) — pure geometry over a set of selected node
 * rects. Each function returns the new top-left position for every rect that
 * moves, keyed by id; the app applies them the same way `nudgeSelection` does
 * (`node.x = …; node.y = …; persistBoard()`). No DOM, no node-kind coupling —
 * just rectangles in, positions out, so the math is pinned by tests.
 */

export type AlignRect = {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
};

export enum AlignKind {
	Left = "left",
	CenterX = "center-x",
	Right = "right",
	Top = "top",
	MiddleY = "middle-y",
	Bottom = "bottom",
}

export enum DistributeAxis {
	Horizontal = "horizontal",
	Vertical = "vertical",
}

export type Positions = Map<string, { x: number; y: number }>;

function boundingBox(rects: readonly AlignRect[]) {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const r of rects) {
		minX = Math.min(minX, r.x);
		minY = Math.min(minY, r.y);
		maxX = Math.max(maxX, r.x + r.width);
		maxY = Math.max(maxY, r.y + r.height);
	}
	return { minX, minY, maxX, maxY };
}

/**
 * Align every rect to a shared edge/centre of the selection's bounding box.
 * Needs ≥2 rects to do anything (one rect is already aligned to itself); a
 * smaller selection returns each rect at its current position.
 */
export function alignRects(rects: readonly AlignRect[], kind: AlignKind): Positions {
	const out: Positions = new Map();
	if (rects.length < 2) {
		for (const r of rects) out.set(r.id, { x: r.x, y: r.y });
		return out;
	}
	const { minX, minY, maxX, maxY } = boundingBox(rects);
	const centerX = (minX + maxX) / 2;
	const centerY = (minY + maxY) / 2;
	for (const r of rects) {
		let { x, y } = r;
		switch (kind) {
			case AlignKind.Left:
				x = minX;
				break;
			case AlignKind.CenterX:
				x = centerX - r.width / 2;
				break;
			case AlignKind.Right:
				x = maxX - r.width;
				break;
			case AlignKind.Top:
				y = minY;
				break;
			case AlignKind.MiddleY:
				y = centerY - r.height / 2;
				break;
			case AlignKind.Bottom:
				y = maxY - r.height;
				break;
		}
		out.set(r.id, { x, y });
	}
	return out;
}

/**
 * Distribute rects so the gaps between consecutive rects (along the axis) are
 * equal — the two extreme rects stay anchored. Needs ≥3 rects; a smaller
 * selection returns each at its current position. Ties in the sort key keep a
 * stable order.
 */
export function distributeRects(rects: readonly AlignRect[], axis: DistributeAxis): Positions {
	const out: Positions = new Map();
	if (rects.length < 3) {
		for (const r of rects) out.set(r.id, { x: r.x, y: r.y });
		return out;
	}
	const horizontal = axis === DistributeAxis.Horizontal;
	const sorted = [...rects].sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
	const sizeOf = (r: AlignRect) => (horizontal ? r.width : r.height);
	const startOf = (r: AlignRect) => (horizontal ? r.x : r.y);

	const first = sorted[0] as AlignRect;
	const last = sorted[sorted.length - 1] as AlignRect;
	const span = startOf(last) + sizeOf(last) - startOf(first);
	const totalSize = sorted.reduce((sum, r) => sum + sizeOf(r), 0);
	const gap = (span - totalSize) / (sorted.length - 1);

	let cursor = startOf(first);
	for (const r of sorted) {
		const pos = horizontal ? { x: cursor, y: r.y } : { x: r.x, y: cursor };
		out.set(r.id, pos);
		cursor += sizeOf(r) + gap;
	}
	return out;
}
