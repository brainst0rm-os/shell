/**
 * `node-dom` — the pure node→DOM content builder.
 *
 * Split out of `app.ts`'s `renderNode` so the per-kind body/header/image
 * construction (the part that decides *what is inside a node and which
 * classes it carries*) is testable without booting the app, Pixi, or the
 * gesture/drag/object-menu wiring. `renderNode` keeps ownership of the
 * outer box, geometry, handles and listeners; it delegates the inner
 * content + the kind class list here.
 *
 * Invariant this module exists to protect (the "black empty box"
 * regression): every node kind yields a content element carrying real
 * text/children, and the kind class drives a *theme-token* fill + text
 * colour that always resolves (the fallbacks live in `styles.css`). A
 * Sticky was historically immune only because its fill + text are
 * theme-independent literals; this keeps every other kind from silently
 * collapsing to an unstyled transparent box when the shell's preload
 * token sheet lands a frame late or out of the node layer's scope.
 */

import type { TranslationParams, WhiteboardMessageKey } from "../i18n/t";
import { type InkPoint, inkPointsAttr } from "../logic/ink";
import {
	NodeKind,
	ShapeKind,
	type StickyNode,
	type TextNode,
	type WhiteboardNode,
	fontFamilyToCss,
	isSvgShape,
	stickyColorToCss,
	textColorToCss,
	textSizeToCss,
} from "../types/node";
import type { RichRun } from "../types/rich-text";
import { appendRunsTo } from "./rich-dom";

/** The optional inline vars a text-bearing node contributes for the 9.17.12
 *  styling (size / colour / font). Only the set ones appear, so the CSS
 *  fallbacks stay the source of the defaults. */
function textStyleVars(node: StickyNode | TextNode): Record<string, string> {
	const vars: Record<string, string> = {};
	if (node.textSize) vars["--node-text-size"] = textSizeToCss(node.textSize);
	if (node.textColor) {
		const css = textColorToCss(node.textColor);
		if (css) vars["--node-text-color"] = css;
	}
	if (node.fontFamily) vars["--node-font"] = fontFamilyToCss(node.fontFamily);
	if (node.bold) vars["--node-font-weight"] = "600";
	if (node.italic) vars["--node-font-style"] = "italic";
	return vars;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Build the SVG geometry for the stroked / filled non-box shapes (9.17.10).
 *  Drawn in a `0 0 100 100` viewBox with `preserveAspectRatio="none"` so it
 *  stretches to the node box; stroked shapes use `non-scaling-stroke` so the
 *  line keeps ~uniform width as the box resizes. The colour is the node tint
 *  (set as `--node-tint` on the host); stroke/fill read it via CSS. */
function buildShapeSvg(doc: Document, shape: ShapeKind): SVGSVGElement {
	const svg = doc.createElementNS(SVG_NS, "svg");
	svg.setAttribute("class", "whiteboard__shape-svg");
	svg.setAttribute("viewBox", "0 0 100 100");
	svg.setAttribute("preserveAspectRatio", "none");
	svg.setAttribute("aria-hidden", "true");

	const stroked = shape === ShapeKind.Line || shape === ShapeKind.Arrow;
	if (stroked) {
		svg.classList.add("whiteboard__shape-svg--stroke");
		const x2 = shape === ShapeKind.Arrow ? 88 : 96;
		const line = doc.createElementNS(SVG_NS, "line");
		line.setAttribute("x1", "4");
		line.setAttribute("y1", "50");
		line.setAttribute("x2", String(x2));
		line.setAttribute("y2", "50");
		line.setAttribute("vector-effect", "non-scaling-stroke");
		svg.appendChild(line);
		if (shape === ShapeKind.Arrow) {
			const head = doc.createElementNS(SVG_NS, "polygon");
			head.setAttribute("points", "84,42 98,50 84,58");
			head.setAttribute("class", "whiteboard__shape-svg-head");
			svg.appendChild(head);
		}
	} else {
		svg.classList.add("whiteboard__shape-svg--fill");
		const poly = doc.createElementNS(SVG_NS, "polygon");
		poly.setAttribute(
			"points",
			shape === ShapeKind.Triangle ? "50,6 94,94 6,94" : "50,4 96,50 50,96 4,50",
		);
		svg.appendChild(poly);
	}
	return svg;
}

/** Build the freehand-ink SVG (9.17.9): a stroked polyline over the
 *  normalised `0..100` path, drawn in a stretched viewBox like the shapes. */
function buildInkSvg(doc: Document, points: readonly InkPoint[]): SVGSVGElement {
	const svg = doc.createElementNS(SVG_NS, "svg");
	svg.setAttribute("class", "whiteboard__ink-svg");
	svg.setAttribute("viewBox", "0 0 100 100");
	svg.setAttribute("preserveAspectRatio", "none");
	svg.setAttribute("aria-hidden", "true");
	const line = doc.createElementNS(SVG_NS, "polyline");
	line.setAttribute("points", inkPointsAttr(points));
	line.setAttribute("vector-effect", "non-scaling-stroke");
	svg.appendChild(line);
	return svg;
}

export type NodeContentT = (key: WhiteboardMessageKey, params?: TranslationParams) => string;

export type NodeContent = {
	/** Extra classes beyond the base `whiteboard__node` + kind class. */
	readonly extraClasses: readonly string[];
	/** Inline custom properties to set on the node element (e.g. the
	 *  sticky / frame tint), so the CSS rule's `var(--node-tint, …)`
	 *  fallback chain stays the single source of the colour. */
	readonly vars: Readonly<Record<string, string>>;
	/** Accessibility attributes for the node element. */
	readonly aria: Readonly<Record<string, string>>;
	/** The inner content nodes (body / header / image / SVG geometry). Widened
	 *  to `Element` so the SVG shapes (9.17.10) fit alongside the HTML bodies;
	 *  `appendChild` accepts any node. */
	readonly children: readonly Element[];
};

/** A node's editable text region. The model text is the persisted
 *  contract; the box never grows from content (CSS clips overflow). */
export function buildTextBody(
	doc: Document,
	nodeId: string,
	text: string,
	placeholderKey: WhiteboardMessageKey,
	t: NodeContentT,
	rich?: readonly RichRun[],
): HTMLDivElement {
	const body = doc.createElement("div");
	body.className = "whiteboard__node-body";
	if (rich && rich.length > 0) {
		appendRunsTo(body, rich);
	} else if (text) {
		body.textContent = text;
	} else {
		body.classList.add("whiteboard__node-body--placeholder");
		body.textContent = t(placeholderKey);
	}
	body.dataset.nodeId = nodeId;
	return body;
}

/** Build the kind-specific inner content + class/aria/var contributions
 *  for a node. Pure: no listeners, no app state, DOM only. */
export function buildNodeContent(
	doc: Document,
	node: WhiteboardNode,
	t: NodeContentT,
): NodeContent {
	switch (node.kind) {
		case NodeKind.Sticky:
			return {
				extraClasses: [],
				vars: {
					"--node-tint": stickyColorToCss(node.color),
					...textStyleVars(node),
				},
				aria: {
					role: "group",
					"aria-label": t("whiteboard.node.sticky.aria", {
						text: node.text || t("whiteboard.node.sticky.placeholder"),
					}),
				},
				children: [
					buildTextBody(doc, node.id, node.text, "whiteboard.node.sticky.placeholder", t, node.rich),
				],
			};
		case NodeKind.Text:
			return {
				extraClasses: [`whiteboard__node--text-${node.format}`],
				vars: textStyleVars(node),
				aria: {
					role: "group",
					"aria-label": t("whiteboard.node.text.aria", {
						text: node.text || t("whiteboard.node.text.placeholder"),
					}),
				},
				children: [
					buildTextBody(doc, node.id, node.text, "whiteboard.node.text.placeholder", t, node.rich),
				],
			};
		case NodeKind.Image: {
			const alt = node.alt ?? "";
			const body = doc.createElement("div");
			body.className = "whiteboard__node-body";
			if (node.imageUrl) {
				const img = doc.createElement("img");
				img.alt = alt || t("whiteboard.node.image.alt");
				img.style.objectFit = node.fit;
				// A broken / blocked src must not render an empty node —
				// fall back to a labelled placeholder so the node stays
				// legible and editable.
				img.addEventListener(
					"error",
					() => {
						const ph = doc.createElement("div");
						ph.className = "whiteboard__node-image-fallback";
						ph.textContent = alt || t("whiteboard.node.image.alt");
						img.replaceWith(ph);
					},
					{ once: true },
				);
				img.src = node.imageUrl;
				body.appendChild(img);
			} else {
				// No src at all — still never an empty box.
				const ph = doc.createElement("div");
				ph.className = "whiteboard__node-image-fallback";
				ph.textContent = alt || t("whiteboard.node.image.alt");
				body.appendChild(ph);
			}
			return {
				extraClasses: [],
				vars: {},
				aria: {
					role: "img",
					"aria-label": t("whiteboard.node.image.aria", {
						alt: alt || t("whiteboard.node.image.alt"),
					}),
				},
				children: [body],
			};
		}
		case NodeKind.Frame: {
			const header = doc.createElement("div");
			header.className = "whiteboard__frame-header";
			header.setAttribute("role", "heading");
			header.setAttribute("aria-level", "3");
			header.textContent = node.title || t("whiteboard.node.frame.title");
			return {
				extraClasses: [],
				vars: node.colorHint ? { "--node-tint": node.colorHint } : {},
				aria: {
					role: "group",
					"aria-label": t("whiteboard.node.frame.aria", {
						title: node.title || t("whiteboard.node.frame.title"),
					}),
				},
				children: [header],
			};
		}
		case NodeKind.Group:
			return {
				extraClasses: [],
				vars: node.colorHint ? { "--node-tint": node.colorHint } : {},
				aria: {
					role: "group",
					"aria-label": t("whiteboard.node.group.aria", {
						count: node.memberIds.length,
					}),
				},
				children: [],
			};
		case NodeKind.Embedded: {
			const body = doc.createElement("div");
			body.className = "whiteboard__node-body";
			// Until the BP block resolves (9.17.4) the embed must not be a
			// bare empty box — show the entity ref it will resolve.
			body.textContent = node.entityRef;
			body.classList.add("whiteboard__node-body--placeholder");
			return {
				extraClasses: [],
				vars: {},
				aria: {
					role: "group",
					"aria-label": t("whiteboard.node.embedded.aria"),
				},
				children: [body],
			};
		}
		case NodeKind.Shape: {
			// Rectangle / Ellipse are a tinted box (the fill div, rounded for
			// the ellipse via CSS). Line / Arrow / Triangle / Diamond are SVG
			// geometry stroked / filled in the node tint (9.17.10).
			let body: Element;
			if (isSvgShape(node.shape)) {
				body = buildShapeSvg(doc, node.shape);
			} else {
				const fill = doc.createElement("div");
				fill.className = "whiteboard__shape-fill";
				body = fill;
			}
			return {
				extraClasses: [`whiteboard__node--shape-${node.shape}`],
				vars: { "--node-tint": stickyColorToCss(node.color) },
				aria: {
					role: "img",
					"aria-label": t("whiteboard.node.shape.aria", {
						shape: t(`whiteboard.shape.${node.shape}`),
					}),
				},
				children: [body],
			};
		}
		case NodeKind.Ink:
			return {
				extraClasses: [],
				vars: { "--node-tint": stickyColorToCss(node.color) },
				aria: {
					role: "img",
					"aria-label": t("whiteboard.node.ink.aria"),
				},
				children: [buildInkSvg(doc, node.points)],
			};
	}
}
