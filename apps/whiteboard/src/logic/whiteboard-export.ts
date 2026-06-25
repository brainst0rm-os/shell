/**
 * 9.17.8 (text/vector half) — pure serialisers for the board.
 *
 * Mirrors the Graph app's 9.13.13a/a.1 split: JSON (portable model) +
 * SVG (the board *as drawn* — the headline export for a visual canvas)
 * are dependency-free and back a copy-to-clipboard affordance. PNG
 * raster + a Files-host `requestSave` destination are the genuinely
 * dep-gated 9.17.8b tail (Stage 9.10).
 *
 * SVG fidelity: nodes z-ordered then drawn as kind-appropriate shapes;
 * edges reuse the exact `edge-path` keystones the renderer uses, so an
 * exported connector traces the same curve/elbow (incl. obstacle-aware
 * step routing) the user sees. Images export as a labelled placeholder
 * (a blob:/brainstorm:// href wouldn't resolve in a pasted-elsewhere
 * SVG — honest + portable beats broken). Pure + deterministic: no DOM,
 * no app/render-layer types — unit-tested without the canvas.
 */

import { ArrowHead, EdgePathKind, type WhiteboardEdge } from "../types/edge";
import {
	TextBlockFormat,
	type WhiteboardNode,
	isFrame,
	isGroup,
	isImage,
	isInk,
	isSticky,
	isText,
	stickyColorToCss,
} from "../types/node";
import type { Whiteboard } from "../types/whiteboard";
import {
	edgePath,
	edgePathMidpoint,
	polylineMidpoint,
	polylinePathD,
	stepPolylineAvoiding,
} from "./edge-path";
import { positionForHandle } from "./handle-positions";

export enum WhiteboardExportFormat {
	Json = "json",
	Svg = "svg",
}

const SVG_PAD = 40;

function r2(n: number): number {
	return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** XML 1.0 attribute/text escaping — `&` first so it can't double-escape. */
function xmlEscape(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Single-line clamp for an SVG `<text>` — the canvas wraps, a vector
 *  snapshot doesn't, so over-long text is ellipsised to roughly the box
 *  width rather than overflowing the node. */
function clampLine(text: string, widthPx: number): string {
	const flat = text.replace(/\s+/g, " ").trim();
	const max = Math.max(4, Math.floor(widthPx / 7));
	return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

// ─── JSON ──────────────────────────────────────────────────────────────────

/** Portable, versioned snapshot — the board model + its edges. */
export function toJSON(board: Whiteboard, edges: readonly WhiteboardEdge[]): string {
	return JSON.stringify(
		{
			format: "brainstorm/whiteboard-export/v1",
			board: { id: board.id, name: board.name, nodes: board.nodes },
			edges,
		},
		null,
		2,
	);
}

// ─── SVG ───────────────────────────────────────────────────────────────────

function nodeFill(n: WhiteboardNode): string {
	if (isSticky(n)) return stickyColorToCss(n.color);
	if (isImage(n)) return "#e5e7eb";
	if (isFrame(n)) return "#f8fafc";
	return "none"; // Text / Group / Embedded — no fill plate
}

function nodeStroke(n: WhiteboardNode): string {
	if (isFrame(n)) return n.colorHint ?? "#94a3b8";
	if (isGroup(n)) return n.colorHint ?? "#cbd5e1";
	if (isImage(n)) return "#cbd5e1";
	return "none";
}

function nodeText(n: WhiteboardNode): string {
	if (isSticky(n) || isText(n)) return n.text;
	if (isFrame(n)) return n.title;
	if (isImage(n)) return n.alt ? `🖼 ${n.alt}` : "🖼 image";
	return "";
}

function renderNode(n: WhiteboardNode): string[] {
	// Freehand ink (9.17.9) is geometry, not a box-with-label: emit the stroke
	// as a polyline mapping the normalised 0..100 path into the node box, so it
	// survives SVG export rather than vanishing into a blank reserved gap.
	if (isInk(n)) {
		const pts = n.points
			.map((p) => `${r2(n.x + (p.x / 100) * n.width)},${r2(n.y + (p.y / 100) * n.height)}`)
			.join(" ");
		return [
			`  <polyline points="${pts}" fill="none" stroke="${xmlEscape(
				stickyColorToCss(n.color),
			)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
		];
	}
	const out: string[] = [];
	const dashed = isGroup(n) ? ' stroke-dasharray="4 3"' : "";
	const stroke = nodeStroke(n);
	const fill = nodeFill(n);
	if (fill !== "none" || stroke !== "none") {
		out.push(
			`  <rect x="${r2(n.x)}" y="${r2(n.y)}" width="${r2(n.width)}" height="${r2(
				n.height,
			)}" rx="6" fill="${xmlEscape(fill)}" stroke="${xmlEscape(stroke)}"${dashed}/>`,
		);
	}
	const label = clampLine(nodeText(n), n.width);
	if (label) {
		const heading = isText(n) && n.format === TextBlockFormat.Heading;
		out.push(
			`  <text x="${r2(n.x + n.width / 2)}" y="${r2(
				n.y + (isFrame(n) ? 14 : n.height / 2),
			)}" text-anchor="middle" dominant-baseline="middle" font-size="${
				heading ? 16 : 12
			}" fill="#1e293b">${xmlEscape(label)}</text>`,
		);
	}
	return out;
}

function renderEdge(edge: WhiteboardEdge, byId: ReadonlyMap<string, WhiteboardNode>): string[] {
	const src = byId.get(edge.sourceNodeId);
	const dst = byId.get(edge.destNodeId);
	if (!src || !dst) return []; // dangling — can't place it
	const from = positionForHandle(src, edge.sourceHandle);
	const to = positionForHandle(dst, edge.destHandle);
	const kind = edge.pathKind as EdgePathKind;

	let d: string;
	let mid: { x: number; y: number };
	if (kind === EdgePathKind.Step) {
		const rect = (n: WhiteboardNode) => ({ x: n.x, y: n.y, width: n.width, height: n.height });
		const pts = stepPolylineAvoiding(from, edge.sourceHandle, to, edge.destHandle, [
			rect(src),
			rect(dst),
		]);
		d = polylinePathD(pts);
		mid = polylineMidpoint(pts);
	} else {
		d = edgePath(kind, from, edge.sourceHandle, to, edge.destHandle);
		mid = edgePathMidpoint(kind, from, edge.sourceHandle, to, edge.destHandle);
	}
	const stroke = edge.colorHint ?? "#64748b";
	const marker = edge.arrowHead !== ArrowHead.None ? ' marker-end="url(#wb-arrow)"' : "";
	const out = [
		`  <path d="${d}" fill="none" stroke="${xmlEscape(stroke)}" stroke-width="2"${marker}/>`,
	];
	if (edge.label) {
		out.push(
			`  <text x="${r2(mid.x)}" y="${r2(
				mid.y,
			)}" text-anchor="middle" dominant-baseline="middle" font-size="12" fill="#475569">${xmlEscape(
				edge.label,
			)}</text>`,
		);
	}
	return out;
}

/**
 * The board as a standalone `<svg>` — edges under nodes, nodes z-ordered
 * (then document order), viewBox auto-fit to the node bounding box with
 * a pad. Empty board → a minimal valid 1×1 svg (never malformed).
 */
export function toSVG(board: Whiteboard, edges: readonly WhiteboardEdge[]): string {
	const nodes = [...board.nodes].sort(
		(a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0) || board.nodes.indexOf(a) - board.nodes.indexOf(b),
	);
	const byId = new Map(board.nodes.map((n) => [n.id, n] as const));

	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const n of nodes) {
		minX = Math.min(minX, n.x);
		minY = Math.min(minY, n.y);
		maxX = Math.max(maxX, n.x + n.width);
		maxY = Math.max(maxY, n.y + n.height);
	}
	const has = nodes.length > 0 && Number.isFinite(minX);
	const vbX = has ? r2(minX - SVG_PAD) : 0;
	const vbY = has ? r2(minY - SVG_PAD) : 0;
	const vbW = has ? r2(maxX - minX + SVG_PAD * 2) : 1;
	const vbH = has ? r2(maxY - minY + SVG_PAD * 2) : 1;

	const lines: string[] = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" font-family="sans-serif">`,
		'  <defs><marker id="wb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="context-stroke"/></marker></defs>',
	];
	for (const e of edges) lines.push(...renderEdge(e, byId));
	for (const n of nodes) lines.push(...renderNode(n));
	lines.push("</svg>");
	return lines.join("\n");
}

/** The single dispatch the UI calls. */
export function exportWhiteboard(
	board: Whiteboard,
	edges: readonly WhiteboardEdge[],
	format: WhiteboardExportFormat,
): string {
	return format === WhiteboardExportFormat.Json ? toJSON(board, edges) : toSVG(board, edges);
}
