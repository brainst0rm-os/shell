/**
 * @vitest-environment jsdom
 *
 * Presence overlay renderer (9.17.19): remote cursors carry the peer
 * colour + bounded name label at canvas coordinates; remote selections
 * outline the claimed node rects; repaints fully replace the layer.
 */

import { describe, expect, it } from "vitest";
import type { RemotePeer } from "../logic/presence";
import { type PresenceNodeRect, renderPresenceOverlay } from "./presence-overlay";

function peer(over: Partial<RemotePeer>): RemotePeer {
	return {
		clientId: 2,
		name: "Marcus",
		color: "#2f6df6",
		boardId: "wb1",
		cursor: { x: 40, y: 60 },
		selection: [],
		...over,
	};
}

describe("renderPresenceOverlay", () => {
	it("renders one cursor per peer with pointer + name chip at canvas coords", () => {
		const layer = document.createElement("div");
		renderPresenceOverlay(layer, [peer({})], new Map());
		const cursor = layer.querySelector<HTMLElement>(".whiteboard__presence-cursor");
		expect(cursor?.style.left).toBe("40px");
		expect(cursor?.style.top).toBe("60px");
		expect(cursor?.querySelector("path")?.getAttribute("fill")).toBe("#2f6df6");
		const name = cursor?.querySelector<HTMLElement>(".whiteboard__presence-name");
		expect(name?.textContent).toBe("Marcus");
		expect(name?.style.background).toBeTruthy();
	});

	it("skips the cursor when the peer's pointer is off-canvas", () => {
		const layer = document.createElement("div");
		renderPresenceOverlay(layer, [peer({ cursor: null })], new Map());
		expect(layer.querySelector(".whiteboard__presence-cursor")).toBeNull();
	});

	it("outlines remotely selected node rects in the peer colour", () => {
		const layer = document.createElement("div");
		const rects = new Map<string, PresenceNodeRect>([["n1", { x: 5, y: 6, width: 100, height: 50 }]]);
		renderPresenceOverlay(layer, [peer({ selection: ["n1", "missing"] })], rects);
		const outline = layer.querySelector<HTMLElement>(".whiteboard__presence-selection");
		expect(outline?.style.left).toBe("5px");
		expect(outline?.style.width).toBe("100px");
		expect(outline?.style.borderColor).toBeTruthy();
		// A selected node with no rect (hidden / gone) renders nothing.
		expect(layer.querySelectorAll(".whiteboard__presence-selection")).toHaveLength(1);
	});

	it("a repaint replaces the previous frame entirely", () => {
		const layer = document.createElement("div");
		renderPresenceOverlay(layer, [peer({})], new Map());
		expect(layer.childElementCount).toBe(1);
		renderPresenceOverlay(layer, [], new Map());
		expect(layer.childElementCount).toBe(0);
	});
});
