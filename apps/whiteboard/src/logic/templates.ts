/**
 * Board templates (9.17.18) — pure scene builders for "new from template".
 *
 * Each template returns the nodes (and node-relative connectors) a fresh
 * board should open with. Kept Pixi-free + side-effect-light (node ids come
 * from the `node-factory` generator, so they're unique but not deterministic
 * — tests assert structure/positions/text, never ids). The app turns the
 * relative `TemplateEdge`s into real `WhiteboardEdge`s once it knows the new
 * board's id, so this module never touches persistence or the edge entity.
 */

import { HandleSide } from "../types/edge";
import { ShapeKind, StickyColor, type WhiteboardNode } from "../types/node";
import { createFrameNode, createShapeNode, createStickyNode } from "./node-factory";

export enum BoardTemplate {
	Blank = "blank",
	Kanban = "kanban",
	Flowchart = "flowchart",
	MindMap = "mindMap",
}

/** All templates in menu display order — frozen. */
export const BOARD_TEMPLATES: readonly BoardTemplate[] = Object.freeze([
	BoardTemplate.Blank,
	BoardTemplate.Kanban,
	BoardTemplate.Flowchart,
	BoardTemplate.MindMap,
]);

/** A connector between two nodes the template just created, by their assigned
 *  ids. The app builds the persistable `WhiteboardEdge` from this. */
export type TemplateEdge = {
	sourceNodeId: string;
	sourceHandle: HandleSide;
	destNodeId: string;
	destHandle: HandleSide;
};

export type TemplateContent = {
	nodes: WhiteboardNode[];
	edges: TemplateEdge[];
};

function sticky(x: number, y: number, text: string, color: StickyColor): WhiteboardNode {
	const node = createStickyNode({ x, y });
	node.text = text;
	node.color = color;
	return node;
}

function frame(x: number, y: number, width: number, height: number, title: string): WhiteboardNode {
	const node = createFrameNode({ x, y });
	node.x = x;
	node.y = y;
	node.width = width;
	node.height = height;
	node.title = title;
	return node;
}

function shape(x: number, y: number, kind: ShapeKind): WhiteboardNode {
	return createShapeNode({ x, y }, kind);
}

// Plain-English seed strings (templates seed concrete starter content, not
// translation keys — they become editable user text the moment the board
// opens, so localising the seed is out of scope, mirroring how a blank sticky
// seeds an empty string rather than a localised placeholder).
const COLUMN_TITLES = ["To do", "Doing", "Done"];

/** Three columns (To do / Doing / Done) with a seed card in the first. */
function kanban(): TemplateContent {
	const colW = 300;
	const colH = 520;
	const gap = 32;
	const top = 80;
	const left = 80;
	const nodes: WhiteboardNode[] = COLUMN_TITLES.map((title, i) =>
		frame(left + i * (colW + gap), top, colW, colH, title),
	);
	// One seed card so the column model is obvious on open.
	nodes.push(sticky(left + 60, top + 80, "", StickyColor.Yellow));
	return { nodes, edges: [] };
}

/** Start → Process → Decision → End, chained with right-angle connectors. */
function flowchart(): TemplateContent {
	const top = 120;
	const left = 80;
	const stepW = 200;
	const gap = 120;
	const start = sticky(left, top, "Start", StickyColor.Green);
	const process = shape(left + (stepW + gap), top, ShapeKind.Rectangle);
	const decision = sticky(left + 2 * (stepW + gap), top, "Decision?", StickyColor.Blue);
	const end = sticky(left + 3 * (stepW + gap), top, "End", StickyColor.Pink);
	const nodes = [start, process, decision, end];
	const chain = [start, process, decision, end];
	const edges: TemplateEdge[] = [];
	for (let i = 1; i < chain.length; i++) {
		edges.push({
			sourceNodeId: (chain[i - 1] as WhiteboardNode).id,
			sourceHandle: HandleSide.Right,
			destNodeId: (chain[i] as WhiteboardNode).id,
			destHandle: HandleSide.Left,
		});
	}
	return { nodes, edges };
}

/** A central topic with four radiating branches. */
function mindMap(): TemplateContent {
	const cx = 480;
	const cy = 320;
	const center = sticky(cx, cy, "Central idea", StickyColor.Purple);
	const offsets: Array<[number, number, HandleSide, HandleSide]> = [
		[cx - 320, cy - 180, HandleSide.Left, HandleSide.Right],
		[cx + 320, cy - 180, HandleSide.Right, HandleSide.Left],
		[cx - 320, cy + 180, HandleSide.Left, HandleSide.Right],
		[cx + 320, cy + 180, HandleSide.Right, HandleSide.Left],
	];
	const nodes: WhiteboardNode[] = [center];
	const edges: TemplateEdge[] = [];
	for (const [x, y, centerSide, branchSide] of offsets) {
		const branch = sticky(x, y, "Branch", StickyColor.Gray);
		nodes.push(branch);
		edges.push({
			sourceNodeId: center.id,
			sourceHandle: centerSide,
			destNodeId: branch.id,
			destHandle: branchSide,
		});
	}
	return { nodes, edges };
}

/** Build the starter scene for a template. `Blank` is empty. */
export function buildTemplate(template: BoardTemplate): TemplateContent {
	switch (template) {
		case BoardTemplate.Blank:
			return { nodes: [], edges: [] };
		case BoardTemplate.Kanban:
			return kanban();
		case BoardTemplate.Flowchart:
			return flowchart();
		case BoardTemplate.MindMap:
			return mindMap();
	}
}
