import { describe, expect, it } from "vitest";
import { computePopoverPlacement } from "./popover-placement";

const OPTS = { width: 320, margin: 8, minHeight: 160 };
const VIEWPORT = { width: 1100, height: 728 };

describe("computePopoverPlacement", () => {
	it("opens below the anchor and clamps maxHeight to the room below (F-015)", () => {
		// Anchor near the top (a toolbar gear): plenty of room below.
		const p = computePopoverPlacement({ top: 132, bottom: 148, right: 660 }, VIEWPORT, OPTS);
		expect(p.top).toBe(156); // 148 + 8
		expect(p.bottom).toBeNull();
		// maxHeight must keep the panel inside the viewport: 728 - 148 - 8 = 572.
		expect(p.maxHeight).toBe(572);
		expect((p.top ?? 0) + p.maxHeight).toBeLessThanOrEqual(VIEWPORT.height);
	});

	it("never lets the panel run past the bottom edge for any anchor near the top", () => {
		for (const bottom of [100, 200, 300]) {
			const p = computePopoverPlacement({ top: bottom - 16, bottom, right: 660 }, VIEWPORT, OPTS);
			expect(p.top).not.toBeNull();
			expect((p.top ?? 0) + p.maxHeight).toBeLessThanOrEqual(VIEWPORT.height);
		}
	});

	it("flips above the anchor when there is materially more room above", () => {
		// Anchor near the bottom: little room below, lots above.
		const p = computePopoverPlacement({ top: 660, bottom: 680, right: 660 }, VIEWPORT, OPTS);
		expect(p.top).toBeNull();
		// `bottom` is distance from the viewport bottom to the anchor top.
		expect(p.bottom).toBe(728 - 660 + 8); // 76
		expect(p.maxHeight).toBe(660 - 8); // spaceAbove = 652
	});

	it("right-aligns to the anchor and clamps left within the viewport", () => {
		// A right edge that would push the panel off the left: clamp to margin.
		const p = computePopoverPlacement({ top: 132, bottom: 148, right: 200 }, VIEWPORT, OPTS);
		expect(p.left).toBe(8); // 200 - 320 = -120 → clamped to margin
		// A normal right edge right-aligns: right - width.
		const q = computePopoverPlacement({ top: 132, bottom: 148, right: 660 }, VIEWPORT, OPTS);
		expect(q.left).toBe(660 - 320);
	});

	it("floors maxHeight at minHeight even when the chosen side is tiny", () => {
		// Anchor pinned to the very bottom with negligible room either side path:
		// pick a viewport so both sides are below minHeight, ensure the floor holds.
		const tiny = { width: 1100, height: 200 };
		const p = computePopoverPlacement({ top: 90, bottom: 110, right: 660 }, tiny, OPTS);
		expect(p.maxHeight).toBeGreaterThanOrEqual(OPTS.minHeight);
	});
});
