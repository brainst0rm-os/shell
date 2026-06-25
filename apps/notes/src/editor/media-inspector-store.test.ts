import { describe, expect, it, vi } from "vitest";
import { type InspectorTarget, MediaKind, mediaInspectorStore } from "./media-inspector-store";

function makeAnchor(x: number, y: number, w = 200, h = 150): DOMRect {
	return {
		x,
		y,
		width: w,
		height: h,
		top: y,
		left: x,
		right: x + w,
		bottom: y + h,
		toJSON: () => ({ x, y, width: w, height: h, top: y, left: x, right: x + w, bottom: y + h }),
	} as DOMRect;
}

describe("mediaInspectorStore", () => {
	it("starts empty and notifies subscribers on open / close", () => {
		const listener = vi.fn();
		const unsubscribe = mediaInspectorStore.subscribe(listener);
		expect(mediaInspectorStore.getSnapshot()).toBeNull();
		const target: InspectorTarget = {
			nodeKey: "k1",
			kind: MediaKind.Image,
			anchor: makeAnchor(10, 20),
		};
		mediaInspectorStore.open(target);
		expect(mediaInspectorStore.getSnapshot()).toEqual(target);
		expect(listener).toHaveBeenCalledTimes(1);
		mediaInspectorStore.close();
		expect(mediaInspectorStore.getSnapshot()).toBeNull();
		expect(listener).toHaveBeenCalledTimes(2);
		unsubscribe();
	});

	it("close is a no-op when already closed", () => {
		mediaInspectorStore.close();
		const listener = vi.fn();
		const unsubscribe = mediaInspectorStore.subscribe(listener);
		mediaInspectorStore.close();
		expect(listener).not.toHaveBeenCalled();
		unsubscribe();
	});

	it("reanchor updates only the anchor field", () => {
		mediaInspectorStore.open({
			nodeKey: "k2",
			kind: MediaKind.Video,
			anchor: makeAnchor(0, 0),
		});
		const listener = vi.fn();
		const unsubscribe = mediaInspectorStore.subscribe(listener);
		const next = makeAnchor(50, 80);
		mediaInspectorStore.reanchor(next);
		const snap = mediaInspectorStore.getSnapshot();
		expect(snap?.anchor).toBe(next);
		expect(snap?.nodeKey).toBe("k2");
		expect(snap?.kind).toBe(MediaKind.Video);
		expect(listener).toHaveBeenCalledTimes(1);
		mediaInspectorStore.close();
		unsubscribe();
	});

	it("reanchor is a no-op when no target is open", () => {
		mediaInspectorStore.close();
		const listener = vi.fn();
		const unsubscribe = mediaInspectorStore.subscribe(listener);
		mediaInspectorStore.reanchor(makeAnchor(1, 1));
		expect(listener).not.toHaveBeenCalled();
		unsubscribe();
	});

	it("unsubscribed listener no longer receives notifications", () => {
		const listener = vi.fn();
		const unsubscribe = mediaInspectorStore.subscribe(listener);
		unsubscribe();
		mediaInspectorStore.open({ nodeKey: "k3", kind: MediaKind.Image, anchor: makeAnchor(0, 0) });
		expect(listener).not.toHaveBeenCalled();
		mediaInspectorStore.close();
	});
});
