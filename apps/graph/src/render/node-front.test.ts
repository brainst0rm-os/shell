import { describe, expect, it } from "vitest";
import { NodeFront, chooseNodeFront } from "./node-front";

describe("chooseNodeFront", () => {
	it("below the icon zoom every node is a plain disc", () => {
		expect(chooseNodeFront({ iconZoom: false, hasIcon: true, hasGlyph: true })).toBe(NodeFront.Disc);
		expect(chooseNodeFront({ iconZoom: false, hasIcon: false, hasGlyph: true })).toBe(NodeFront.Disc);
	});

	it("own icon wins when zoomed in and resolved", () => {
		expect(chooseNodeFront({ iconZoom: true, hasIcon: true, hasGlyph: true })).toBe(NodeFront.Icon);
		expect(chooseNodeFront({ iconZoom: true, hasIcon: true, hasGlyph: false })).toBe(NodeFront.Icon);
	});

	it("REGRESSION: an icon-less entity shows its type-glyph at icon zoom, not a bare disc", () => {
		// The exact failure mode: real vault entities carry no own icon,
		// so at fit-zoom (iconZoom true, detail zoom false) they MUST show
		// the type glyph — not the anonymous purple disc the user saw.
		expect(chooseNodeFront({ iconZoom: true, hasIcon: false, hasGlyph: true })).toBe(NodeFront.Glyph);
	});

	it("falls back to a disc only when there is genuinely nothing to draw", () => {
		expect(chooseNodeFront({ iconZoom: true, hasIcon: false, hasGlyph: false })).toBe(NodeFront.Disc);
	});
});
