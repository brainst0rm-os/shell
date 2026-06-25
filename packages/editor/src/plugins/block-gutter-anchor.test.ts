import { describe, expect, it } from "vitest";
import { gutterAnchor } from "./block-gutter-anchor";

const main = { top: 100, bottom: 700, left: 0 };

describe("gutterAnchor", () => {
	it("anchors at the block's top, inset by the gutter offset, when in view", () => {
		expect(gutterAnchor({ top: 300, bottom: 340, left: 220 }, main, 68)).toEqual({
			top: 300,
			left: 152,
		});
	});

	it("clamps to the container top when the block is partially scrolled above it", () => {
		// Block straddles the top edge (top above the container, bottom below).
		expect(gutterAnchor({ top: 60, bottom: 130, left: 220 }, main, 68)).toEqual({
			top: 100, // clamped to mainRect.top, not the off-screen 60
			left: 152,
		});
	});

	it("hides (null) when the block has scrolled fully above the container", () => {
		expect(gutterAnchor({ top: 10, bottom: 90, left: 220 }, main, 68)).toBeNull();
	});

	it("hides (null) when the block has scrolled fully below the container", () => {
		expect(gutterAnchor({ top: 720, bottom: 760, left: 220 }, main, 68)).toBeNull();
	});

	it("keeps showing while any part of the block is still in the band", () => {
		// Bottom edge exactly at the container top → still touching.
		expect(gutterAnchor({ top: 40, bottom: 100, left: 220 }, main, 68)).not.toBeNull();
		// Top edge exactly at the container bottom → still touching.
		expect(gutterAnchor({ top: 700, bottom: 760, left: 220 }, main, 68)).not.toBeNull();
	});
});
