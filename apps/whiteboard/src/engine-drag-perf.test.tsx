// @vitest-environment jsdom
/**
 * 9.17.20 renderer-perf regressions — the three optimized-HTML increments:
 *
 *   1. **Drag without rebuild** — a node-drag frame repositions the *existing*
 *      node elements; it must NOT tear down + recreate the node DOM (the old
 *      `paint()`-per-pointermove that did O(total-nodes) work every frame). We
 *      assert element identity is preserved across a drag for both the dragged
 *      node and an untouched sibling, and that the move still applies.
 *   2. **Viewport culling** — only nodes intersecting the (padded) screen
 *      viewport mount; off-screen nodes are absent from the DOM and reappear
 *      after a pan brings them into view.
 *   3. **Keyed diff reconcile** — a discrete `paint()` (e.g. adding one node)
 *      keeps element identity for the unchanged nodes; only the new node's
 *      element appears.
 *
 * Driven through the real engine behind `<WhiteboardApp>` via the dev hook
 * (a synthetic pointer can't drive `setPointerCapture`, so the hook exercises
 * the *same* primitives the gesture loops call).
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WhiteboardApp } from "./app";
import { flush, renderInto } from "./test/render";

let handle: Awaited<ReturnType<typeof renderInto>> | null = null;

afterEach(async () => {
	await handle?.unmount();
	handle = null;
	window.brainstorm = undefined;
	Reflect.deleteProperty(window, "__brainstormWhiteboardDev");
});

type Dev = NonNullable<Window["__brainstormWhiteboardDev"]>;

async function mount(): Promise<{ container: HTMLElement; wrap: HTMLElement; dev: Dev }> {
	handle = await renderInto(<WhiteboardApp />);
	await flush();
	const container = handle.container;
	const wrap = container.querySelector<HTMLElement>(".whiteboard__canvas-wrap");
	const dev = window.__brainstormWhiteboardDev;
	if (!wrap || !dev) throw new Error("whiteboard surface did not mount");
	return { container, wrap, dev };
}

/** jsdom reports 0 layout dims; give the wrap a real viewport so culling runs
 *  (a 0-size wrap deliberately disables culling — it never hides a node). */
function sizeWrap(wrap: HTMLElement, width: number, height: number): void {
	Object.defineProperty(wrap, "clientWidth", { value: width, configurable: true });
	Object.defineProperty(wrap, "clientHeight", { value: height, configurable: true });
}

function mounted(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll<HTMLElement>(".whiteboard__node[data-node-id]"));
}

describe("9.17.20 — drag does not full-repaint", () => {
	it("preserves node element identity across a drag frame (no teardown+rebuild)", async () => {
		const { dev } = await mount();
		let seeded: string[] = [];
		act(() => {
			seeded = dev.seedGrid(3, { cols: 3, cell: 300 });
		});
		const [aId, bId] = seeded;
		expect(aId).toBeDefined();
		expect(bId).toBeDefined();
		if (!aId || !bId) return;

		const aBefore = dev.nodeEl(aId);
		const bBefore = dev.nodeEl(bId);
		expect(aBefore).not.toBeNull();
		expect(bBefore).not.toBeNull();

		// Several drag frames on A.
		act(() => {
			dev.dragNodeBy(aId, 40, 24);
			dev.dragNodeBy(aId, 40, 24);
			dev.dragNodeBy(aId, 40, 24);
		});

		// SAME element objects — a full rebuild would have replaced them.
		expect(dev.nodeEl(aId)).toBe(aBefore);
		expect(dev.nodeEl(bId)).toBe(bBefore);
		// The move actually applied to the dragged node's element.
		expect(aBefore?.style.left).toBe("120px");
		expect(aBefore?.style.top).toBe("72px");
		// The untouched sibling did not move.
		expect(bBefore?.style.left).toBe("300px");

		// Settle keeps identity too (keyed reconcile, not rebuild).
		act(() => dev.endDrag());
		expect(dev.nodeEl(aId)).toBe(aBefore);
		expect(dev.nodeEl(bId)).toBe(bBefore);
	});

	it("a moved node keeps its element through the discrete settle reconcile", async () => {
		const { dev } = await mount();
		let ids: string[] = [];
		act(() => {
			ids = dev.seedGrid(4, { cols: 2, cell: 250 });
		});
		const id = ids[0];
		if (!id) return;
		const before = dev.nodeEl(id);
		act(() => {
			dev.dragNodeBy(id, 17, 9);
			dev.endDrag();
		});
		// Geometry-only change → signature unchanged → same element.
		expect(dev.nodeEl(id)).toBe(before);
	});
});

describe("9.17.20 — keyed diff reconcile", () => {
	it("keeps unchanged node elements when one node is added", async () => {
		const { container, dev } = await mount();
		let seeded: string[] = [];
		act(() => {
			seeded = dev.seedGrid(3, { cols: 3, cell: 300 });
		});
		const elsBefore = new Map(seeded.map((id) => [id, dev.nodeEl(id)] as const));
		expect(mounted(container).length).toBe(3);

		// Add one more node — discrete paint().
		act(() => dev.seedGrid(1, { cols: 1, cell: 300 }));

		expect(mounted(container).length).toBe(4);
		for (const id of seeded) {
			expect(dev.nodeEl(id)).toBe(elsBefore.get(id));
		}
	});
});

describe("9.17.20 — viewport culling", () => {
	beforeEach(() => {
		// A real on-screen vault drives the camera; the standalone test engine
		// starts at pan 0/zoom 1.
	});

	it("mounts only nodes intersecting the padded viewport; far nodes reappear on pan", async () => {
		const { container, wrap, dev } = await mount();
		sizeWrap(wrap, 800, 600);

		// 25 stickies on a 5×5 grid, 600px apart → a 2400×2400 spread, far wider
		// than the 800×600 viewport (+ one-screenful pad).
		let ids: string[] = [];
		act(() => {
			ids = dev.seedGrid(25, { cols: 5, cell: 600 });
		});
		expect(ids.length).toBe(25);
		// Re-cull at the seeded camera (seedGrid paints before the test sizes the
		// wrap, so re-run the camera cull now that dims exist).
		act(() => dev.setCamera({ panX: 0, panY: 0, zoom: 1 }));

		const mountedNow = new Set(dev.mountedNodeIds());
		// Strictly fewer than all 25 mounted (culling is active) and at least the
		// top-left cluster present.
		expect(mountedNow.size).toBeGreaterThan(0);
		expect(mountedNow.size).toBeLessThan(25);
		expect(mountedNow.has(ids[0] as string)).toBe(true);
		// The far bottom-right node is off-screen → not mounted.
		const farId = ids[24] as string;
		expect(mountedNow.has(farId)).toBe(false);
		expect(dev.nodeEl(farId)).toBeNull();

		// Pan so the far node enters the viewport → it mounts.
		act(() => dev.setCamera({ panX: -2400, panY: -2400, zoom: 1 }));
		expect(dev.nodeEl(farId)).not.toBeNull();
	});

	it("mounts everything when the wrap has no layout (cull disabled, never hides)", async () => {
		const { container, dev } = await mount();
		// wrap left at jsdom's 0×0 — culling must fall back to mount-all.
		act(() => dev.seedGrid(20, { cols: 5, cell: 600 }));
		expect(mounted(container).length).toBe(20);
	});
});
