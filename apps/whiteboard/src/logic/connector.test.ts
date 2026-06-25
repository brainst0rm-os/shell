import { describe, expect, it } from "vitest";
import { ArrowHead, EdgePathKind, HandleSide, type WhiteboardEdge } from "../types/edge";
import type { WhiteboardNode } from "../types/node";
import { NodeKind, StickyColor } from "../types/node";
import {
	buildConnectorEdge,
	isValidConnectorDrop,
	nearestHandleSide,
	newEdgeId,
} from "./connector";

function node(
	over: Pick<WhiteboardNode, "id"> & Partial<Pick<WhiteboardNode, "x" | "y" | "width" | "height">>,
): WhiteboardNode {
	return {
		id: over.id,
		kind: NodeKind.Sticky,
		x: over.x ?? 0,
		y: over.y ?? 0,
		width: over.width ?? 100,
		height: over.height ?? 60,
		text: "",
		color: StickyColor.Yellow,
	};
}

describe("nearestHandleSide", () => {
	const n = node({ id: "n", x: 0, y: 0, width: 100, height: 60 });
	// anchors: top (50,0) right (100,30) bottom (50,60) left (0,30)

	it("picks the closest compass handle to the point", () => {
		expect(nearestHandleSide(n, { x: 48, y: -20 })).toBe(HandleSide.Top);
		expect(nearestHandleSide(n, { x: 140, y: 30 })).toBe(HandleSide.Right);
		expect(nearestHandleSide(n, { x: 50, y: 120 })).toBe(HandleSide.Bottom);
		expect(nearestHandleSide(n, { x: -30, y: 28 })).toBe(HandleSide.Left);
	});

	it("resolves ties to the earlier HANDLE_SIDES entry (deterministic)", () => {
		// Dead centre is equidistant to top & bottom (and left & right);
		// top wins as the first frozen entry.
		expect(nearestHandleSide(n, { x: 50, y: 30 })).toBe(HandleSide.Top);
	});
});

describe("newEdgeId", () => {
	it("is prefixed + unique across calls", () => {
		const a = newEdgeId();
		const b = newEdgeId();
		expect(a.startsWith("wbe_")).toBe(true);
		expect(a).not.toBe(b);
	});
});

describe("buildConnectorEdge", () => {
	it("produces a Step/Arrow edge with deterministic timestamps + id", () => {
		const edge = buildConnectorEdge({
			whiteboardId: "wb1",
			from: { nodeId: "a", side: HandleSide.Right },
			to: { nodeId: "b", side: HandleSide.Left },
			now: 1234,
			id: "fixed",
		});
		expect(edge).toEqual<WhiteboardEdge>({
			id: "fixed",
			whiteboardId: "wb1",
			sourceNodeId: "a",
			sourceHandle: HandleSide.Right,
			destNodeId: "b",
			destHandle: HandleSide.Left,
			pathKind: EdgePathKind.Step,
			arrowHead: ArrowHead.Arrow,
			label: null,
			colorHint: null,
			createdAt: 1234,
			updatedAt: 1234,
		});
	});

	it("auto-generates an id when none is supplied", () => {
		const edge = buildConnectorEdge({
			whiteboardId: "wb",
			from: { nodeId: "a", side: HandleSide.Top },
			to: { nodeId: "b", side: HandleSide.Bottom },
			now: 0,
		});
		expect(edge.id.startsWith("wbe_")).toBe(true);
	});
});

describe("isValidConnectorDrop", () => {
	const existing: WhiteboardEdge[] = [
		buildConnectorEdge({
			whiteboardId: "wb",
			from: { nodeId: "a", side: HandleSide.Right },
			to: { nodeId: "b", side: HandleSide.Left },
			now: 0,
			id: "e1",
		}),
	];

	it("rejects a self-drop", () => {
		expect(isValidConnectorDrop({ nodeId: "a", side: HandleSide.Top }, "a", existing)).toBe(false);
	});

	it("rejects a duplicate parallel edge in the same direction", () => {
		expect(isValidConnectorDrop({ nodeId: "a", side: HandleSide.Top }, "b", existing)).toBe(false);
	});

	it("allows the reverse direction and any new pair", () => {
		expect(isValidConnectorDrop({ nodeId: "b", side: HandleSide.Top }, "a", existing)).toBe(true);
		expect(isValidConnectorDrop({ nodeId: "a", side: HandleSide.Top }, "c", existing)).toBe(true);
	});
});
