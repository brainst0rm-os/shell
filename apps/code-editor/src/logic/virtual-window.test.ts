import { describe, expect, it } from "vitest";
import {
	DEFAULT_OVERSCAN,
	VIRTUALIZE_LINE_THRESHOLD,
	type ViewportMetrics,
	computeLineWindow,
	shouldVirtualize,
} from "./virtual-window";

const LH = 20;

describe("shouldVirtualize", () => {
	it("is false below the threshold", () => {
		expect(shouldVirtualize(0)).toBe(false);
		expect(shouldVirtualize(VIRTUALIZE_LINE_THRESHOLD - 1)).toBe(false);
	});

	it("engages at and above the threshold", () => {
		expect(shouldVirtualize(VIRTUALIZE_LINE_THRESHOLD)).toBe(true);
		expect(shouldVirtualize(VIRTUALIZE_LINE_THRESHOLD + 5000)).toBe(true);
	});
});

describe("computeLineWindow — small files render whole", () => {
	it("returns the full un-windowed slice below the threshold", () => {
		const win = computeLineWindow(50, { scrollTop: 0, viewportHeight: 400, lineHeight: LH });
		expect(win).toEqual({ startLine: 0, endLine: 50, topPad: 0, bottomPad: 0, windowed: false });
	});

	it("never windows even when scrolled, for a small file", () => {
		const win = computeLineWindow(50, { scrollTop: 200, viewportHeight: 400, lineHeight: LH });
		expect(win.windowed).toBe(false);
		expect(win.startLine).toBe(0);
		expect(win.endLine).toBe(50);
	});
});

describe("computeLineWindow — degenerate metrics fall back to whole file", () => {
	const big = VIRTUALIZE_LINE_THRESHOLD + 100;
	const cases: Array<[string, ViewportMetrics]> = [
		["zero line height", { scrollTop: 100, viewportHeight: 400, lineHeight: 0 }],
		["negative line height", { scrollTop: 100, viewportHeight: 400, lineHeight: -5 }],
		["zero viewport", { scrollTop: 100, viewportHeight: 0, lineHeight: LH }],
		["NaN line height", { scrollTop: 100, viewportHeight: 400, lineHeight: Number.NaN }],
		[
			"infinite viewport",
			{ scrollTop: 100, viewportHeight: Number.POSITIVE_INFINITY, lineHeight: LH },
		],
	];
	for (const [name, metrics] of cases) {
		it(name, () => {
			const win = computeLineWindow(big, metrics);
			expect(win).toEqual({
				startLine: 0,
				endLine: big,
				topPad: 0,
				bottomPad: 0,
				windowed: false,
			});
		});
	}
});

describe("computeLineWindow — windowed slice", () => {
	const total = 5000;

	it("renders only the viewport plus overscan at the top", () => {
		const win = computeLineWindow(total, { scrollTop: 0, viewportHeight: 400, lineHeight: LH }, 5);
		expect(win.windowed).toBe(true);
		expect(win.startLine).toBe(0);
		// 400 / 20 = 20 visible lines, + 5 overscan = 25.
		expect(win.endLine).toBe(25);
		expect(win.topPad).toBe(0);
		expect(win.bottomPad).toBe((total - 25) * LH);
	});

	it("slides the window down as the surface scrolls", () => {
		const win = computeLineWindow(
			total,
			{ scrollTop: 100 * LH, viewportHeight: 400, lineHeight: LH },
			5,
		);
		// firstVisible = 100, - 5 overscan = 95.
		expect(win.startLine).toBe(95);
		// lastVisibleExclusive = ceil((2000 + 400)/20) = 120, + 5 = 125.
		expect(win.endLine).toBe(125);
		expect(win.topPad).toBe(95 * LH);
		expect(win.bottomPad).toBe((total - 125) * LH);
	});

	it("clamps the window to the file end when scrolled to the bottom", () => {
		const win = computeLineWindow(
			total,
			{ scrollTop: total * LH, viewportHeight: 400, lineHeight: LH },
			DEFAULT_OVERSCAN,
		);
		expect(win.endLine).toBe(total);
		expect(win.bottomPad).toBe(0);
		expect(win.startLine).toBeLessThan(total);
	});

	it("clamps a negative scrollTop to the top of the file", () => {
		const win = computeLineWindow(
			total,
			{ scrollTop: -500, viewportHeight: 400, lineHeight: LH },
			DEFAULT_OVERSCAN,
		);
		expect(win.startLine).toBe(0);
		expect(win.topPad).toBe(0);
	});
});

describe("computeLineWindow — invariants hold across generated inputs", () => {
	// Deterministic pseudo-random sweep (no fast-check dep): exercises the
	// documented invariants over a broad input space.
	function rng(seed: number): () => number {
		let s = seed >>> 0;
		return () => {
			s = (s * 1664525 + 1013904223) >>> 0;
			return s / 0xffffffff;
		};
	}

	it("holds for 2000 random configurations", () => {
		const rand = rng(12345);
		for (let i = 0; i < 2000; i++) {
			const total = Math.floor(rand() * 60000);
			const lineHeight = Math.floor(rand() * 40) - 4; // includes <= 0 cases
			const viewportHeight = Math.floor(rand() * 2000) - 100; // includes <= 0
			const scrollTop = Math.floor(rand() * (total + 1) * 20) - 200; // includes negatives
			const overscan = Math.floor(rand() * 60) - 5; // includes negatives
			const win = computeLineWindow(total, { scrollTop, viewportHeight, lineHeight }, overscan);

			// Range bounds.
			expect(win.startLine).toBeGreaterThanOrEqual(0);
			expect(win.startLine).toBeLessThanOrEqual(win.endLine);
			expect(win.endLine).toBeLessThanOrEqual(total);

			// Pads never negative.
			expect(win.topPad).toBeGreaterThanOrEqual(0);
			expect(win.bottomPad).toBeGreaterThanOrEqual(0);

			if (win.windowed) {
				// Spacers exactly account for the un-rendered lines.
				expect(win.topPad).toBe(win.startLine * lineHeight);
				expect(win.bottomPad).toBe((total - win.endLine) * lineHeight);

				// Total reserved height equals the whole file's height: the
				// scrollbar reflects every line.
				const renderedHeight = (win.endLine - win.startLine) * lineHeight;
				expect(win.topPad + renderedHeight + win.bottomPad).toBe(total * lineHeight);

				// The slice covers the visible viewport (no clipped line):
				// the first visible line is rendered and the last visible line
				// is rendered. Only checkable when geometry is sane.
				const safeScroll = Math.max(0, scrollTop);
				const firstVisible = Math.floor(safeScroll / lineHeight);
				const lastVisible = Math.min(
					total - 1,
					Math.floor((safeScroll + viewportHeight - 1) / lineHeight),
				);
				if (firstVisible < total) {
					expect(win.startLine).toBeLessThanOrEqual(firstVisible);
				}
				if (lastVisible >= 0) {
					expect(win.endLine).toBeGreaterThan(lastVisible);
				}
			} else {
				// Un-windowed: whole file, no pads.
				expect(win.startLine).toBe(0);
				expect(win.endLine).toBe(total);
				expect(win.topPad).toBe(0);
				expect(win.bottomPad).toBe(0);
			}
		}
	});
});
