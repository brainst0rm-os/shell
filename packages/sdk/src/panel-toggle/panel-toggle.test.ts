/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";
import { PanelSide, panelToggleIcon } from "./panel-toggle-icon";

describe("panelToggleIcon", () => {
	it("renders the panel rect + divider on the left edge", () => {
		const svg = panelToggleIcon(PanelSide.Left, false);
		expect(svg.tagName.toLowerCase()).toBe("svg");
		const lines = Array.from(svg.querySelectorAll("line"));
		expect(lines).toHaveLength(1);
		expect(lines[0]?.getAttribute("x1")).toBe("6");
	});

	it("renders the divider on the right edge for side=right", () => {
		const svg = panelToggleIcon(PanelSide.Right, false);
		const line = svg.querySelector("line");
		expect(line?.getAttribute("x1")).toBe("10");
	});

	it("paints the active fill on the toggled side when open", () => {
		const left = panelToggleIcon(PanelSide.Left, true);
		const right = panelToggleIcon(PanelSide.Right, true);
		// Two <rect>s: outer frame + active-fill.
		const leftRects = left.querySelectorAll("rect");
		const rightRects = right.querySelectorAll("rect");
		expect(leftRects).toHaveLength(2);
		expect(rightRects).toHaveLength(2);
		expect(leftRects[1]?.getAttribute("x")).toBe("2");
		expect(rightRects[1]?.getAttribute("x")).toBe("10.5");
		expect(leftRects[1]?.getAttribute("fill")).toBe("currentColor");
	});

	it("drops the active fill when the panel is closed", () => {
		const svg = panelToggleIcon(PanelSide.Left, false);
		const rects = svg.querySelectorAll("rect");
		expect(rects).toHaveLength(1);
	});

	it("honours the size override (default = 14)", () => {
		const dflt = panelToggleIcon(PanelSide.Left, false);
		const sized = panelToggleIcon(PanelSide.Left, false, 18);
		expect(dflt.getAttribute("width")).toBe("14");
		expect(sized.getAttribute("width")).toBe("18");
		expect(sized.getAttribute("height")).toBe("18");
		// Viewbox stays at 16 so the glyph proportions don't change.
		expect(sized.getAttribute("viewBox")).toBe("0 0 16 16");
	});
});
