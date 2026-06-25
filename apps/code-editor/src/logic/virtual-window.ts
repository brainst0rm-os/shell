/**
 * Large-file line windowing (9.7.10) — parity with Notes 13.4a.
 *
 * The code surface (gutter + Shiki highlight overlay) paints one element
 * per source line. For a very large file that's tens of thousands of DOM
 * nodes built on every keystroke / scroll — the paint cost the Notes
 * virtualization rung removed for rich-text blocks. Notes leans on
 * `content-visibility: auto` because its blocks have variable height;
 * the code surface has uniform monospace line height, so the cheaper,
 * exact answer is index windowing: render only the lines inside the
 * viewport (plus an overscan margin) and reserve the off-screen height
 * with two spacers so the scrollbar still reflects the whole file.
 *
 * This module is the pure keystone that survives the render swap — it
 * owns the "which lines are visible" math; `ui/code-pane.ts` consumes
 * the window to slice the lines it actually builds. No DOM, no
 * CodeMirror dep.
 */

/** Line count at/above which windowing engages. Below this every line is
 *  painted (a small file's full DOM is cheap and avoids the spacer
 *  bookkeeping); the threshold matches the order of magnitude at which a
 *  full per-line paint starts to show on keystroke. */
export const VIRTUALIZE_LINE_THRESHOLD = 1000;

/** Default number of off-screen lines rendered on each side of the
 *  viewport so a fast scroll / wheel-fling doesn't reveal blank gaps
 *  before the next window computes. */
export const DEFAULT_OVERSCAN = 20;

export interface ViewportMetrics {
	/** The surface's current vertical scroll offset, in px. */
	scrollTop: number;
	/** The visible height of the scroll container, in px. */
	viewportHeight: number;
	/** The (uniform) height of one rendered line, in px. Must be > 0. */
	lineHeight: number;
}

export interface LineWindow {
	/** Index (0-based, inclusive) of the first line to render. */
	startLine: number;
	/** Index (0-based, EXCLUSIVE) one past the last line to render. */
	endLine: number;
	/** Reserved height (px) above the rendered slice — the lines from 0
	 *  to `startLine`. The renderer pins a top spacer to this. */
	topPad: number;
	/** Reserved height (px) below the rendered slice — the lines from
	 *  `endLine` to `lineCount`. The renderer pins a bottom spacer to
	 *  this. */
	bottomPad: number;
	/** True when this window is a real sub-range of the file (windowing
	 *  engaged); false when every line is rendered. Lets the renderer
	 *  skip spacer elements entirely in the un-windowed case. */
	windowed: boolean;
}

/** Whether a file of `lineCount` lines should be windowed at all. Pure
 *  predicate so the threshold lives in exactly one place. */
export function shouldVirtualize(lineCount: number): boolean {
	return lineCount >= VIRTUALIZE_LINE_THRESHOLD;
}

/**
 * Compute the slice of lines to render for a viewport.
 *
 * Returns the inclusive `startLine` / exclusive `endLine` plus the top
 * and bottom spacer heights. When the file is below the windowing
 * threshold (or the metrics are degenerate — non-positive line height /
 * viewport) the whole file is returned as one un-windowed slice
 * (`windowed: false`, zero pads), so callers get a single safe code path.
 *
 * Invariants (property-tested):
 *  - `0 <= startLine <= endLine <= lineCount`
 *  - `topPad === startLine * lineHeight`
 *  - `bottomPad === (lineCount - endLine) * lineHeight`
 *  - the rendered slice always covers `[scrollTop, scrollTop+viewportHeight)`
 *    in line space (modulo overscan), so no visible line is ever clipped.
 */
export function computeLineWindow(
	lineCount: number,
	metrics: ViewportMetrics,
	overscan: number = DEFAULT_OVERSCAN,
): LineWindow {
	const total = Math.max(0, Math.floor(lineCount));
	const { lineHeight } = metrics;

	if (
		!shouldVirtualize(total) ||
		lineHeight <= 0 ||
		metrics.viewportHeight <= 0 ||
		!Number.isFinite(lineHeight) ||
		!Number.isFinite(metrics.viewportHeight)
	) {
		return { startLine: 0, endLine: total, topPad: 0, bottomPad: 0, windowed: false };
	}

	const margin = Math.max(0, Math.floor(overscan));
	const scrollTop = Math.max(0, metrics.scrollTop);

	const firstVisible = Math.floor(scrollTop / lineHeight);
	// `ceil` of the bottom edge gives the first line fully past the
	// viewport; that's already exclusive, so it doubles as `endLine`
	// before overscan.
	const lastVisibleExclusive = Math.ceil((scrollTop + metrics.viewportHeight) / lineHeight);

	const startLine = clamp(firstVisible - margin, 0, total);
	const endLine = clamp(lastVisibleExclusive + margin, startLine, total);

	return {
		startLine,
		endLine,
		topPad: startLine * lineHeight,
		bottomPad: (total - endLine) * lineHeight,
		windowed: true,
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
