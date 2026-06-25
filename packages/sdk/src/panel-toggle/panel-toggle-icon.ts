/**
 * Shared sidebar/inspector toggle glyph — the rounded panel rect with a
 * divider on the toggled edge and a filled bar on that edge while the
 * panel is open. ONE source for every first-party app: Notes, Tasks,
 * Bookmarks, Calendar, Code Editor, Files, Database, Whiteboard, and any
 * future app that puts a collapse toggle in its header.
 *
 * Two surfaces live on the same SVG geometry:
 *   - `panelToggleIcon(side, active, size?)` — pure DOM, returns an
 *     `SVGSVGElement` (plain-DOM apps).
 *   - `<PanelToggleIcon side={...} active={...} size={...} />` — React
 *     component (Notes / Files).
 *
 * No new design decisions are encoded here — this is the exact geometry
 * already shipped in 7 hand-rolled copies, lifted unchanged.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** Which edge of the framed rect carries the divider + active fill. */
export enum PanelSide {
	Left = "left",
	Right = "right",
}

/** Default glyph box. Apps that nest the toggle inside a square
 *  `header-icon-btn` overwhelmingly chose 14px in the historical copies;
 *  the React `<PanelToggleIcon>` in `affordance.tsx` defaulted to 16. We
 *  keep 14 as the canonical default and let callers override. */
const DEFAULT_SIZE = 14;

function dividerXFor(side: PanelSide): "6" | "10" {
	return side === PanelSide.Left ? "6" : "10";
}

function activeFillXFor(side: PanelSide): "2" | "10.5" {
	return side === PanelSide.Left ? "2" : "10.5";
}

/** Build the toggle SVG as a detached `SVGSVGElement`. The host button
 *  owns aria/title/click — this function only paints the glyph. */
export function panelToggleIcon(
	side: PanelSide,
	active: boolean,
	size: number = DEFAULT_SIZE,
): SVGSVGElement {
	const svg = document.createElementNS(SVG_NS, "svg");
	svg.setAttribute("width", String(size));
	svg.setAttribute("height", String(size));
	svg.setAttribute("viewBox", "0 0 16 16");
	svg.setAttribute("fill", "none");
	svg.setAttribute("stroke", "currentColor");
	svg.setAttribute("stroke-width", "1.5");
	svg.setAttribute("stroke-linejoin", "round");
	svg.setAttribute("aria-hidden", "true");

	const frame = document.createElementNS(SVG_NS, "rect");
	frame.setAttribute("x", "1.5");
	frame.setAttribute("y", "2.5");
	frame.setAttribute("width", "13");
	frame.setAttribute("height", "11");
	frame.setAttribute("rx", "1.5");
	svg.appendChild(frame);

	const dividerX = dividerXFor(side);
	const divider = document.createElementNS(SVG_NS, "line");
	divider.setAttribute("x1", dividerX);
	divider.setAttribute("y1", "2.5");
	divider.setAttribute("x2", dividerX);
	divider.setAttribute("y2", "13.5");
	svg.appendChild(divider);

	if (active) {
		const fill = document.createElementNS(SVG_NS, "rect");
		fill.setAttribute("x", activeFillXFor(side));
		fill.setAttribute("y", "3");
		fill.setAttribute("width", "3.5");
		fill.setAttribute("height", "10");
		fill.setAttribute("rx", "0.5");
		fill.setAttribute("fill", "currentColor");
		svg.appendChild(fill);
	}
	return svg;
}
