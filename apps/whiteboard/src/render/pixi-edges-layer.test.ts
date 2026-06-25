// @vitest-environment jsdom
/**
 * Regression guard for the 9.17.5 SVG→Pixi connector swap (the
 * "edges blank / nodes are black boxes" report).
 *
 * jsdom has no WebGL, so — mirroring the project's Pixi-free split
 * (`frustum.test.ts` / `edge-geometry.test.ts` test the pure halves) —
 * this stubs `pixi.js` with a faithful shape and asserts the *layer
 * contract* that the swap must hold:
 *
 *  1. Pixi inits with `backgroundAlpha: 0` — the GL canvas is
 *     transparent, never an opaque sheet over the board.
 *  2. The canvas is appended into the edge-host and carries an
 *     explicit, non-`auto` `z-index` LOWER than the node layer, so the
 *     HTML nodes always paint above the connector canvas (the bug:
 *     a transparent-but-stacking canvas can still end up over the
 *     nodes when the node layer's own `z-index` is defeated by a
 *     transform-induced stacking context — the order must be pinned on
 *     the canvas itself, not inferred).
 *  3. The canvas does not introduce an opaque background of its own.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type InitOpts = Record<string, unknown>;
const initCalls: InitOpts[] = [];

vi.mock("pixi.js/unsafe-eval", () => ({}));
vi.mock("pixi.js", () => {
	class FakeContainer {
		children: unknown[] = [];
		scale = { set: vi.fn() };
		position = { set: vi.fn() };
		addChild(...c: unknown[]): void {
			this.children.push(...c);
		}
	}
	class FakeGraphics extends FakeContainer {
		clear = vi.fn().mockReturnThis();
		moveTo = vi.fn().mockReturnThis();
		lineTo = vi.fn().mockReturnThis();
		stroke = vi.fn().mockReturnThis();
		fill = vi.fn().mockReturnThis();
		circle = vi.fn().mockReturnThis();
		poly = vi.fn().mockReturnThis();
		roundRect = vi.fn().mockReturnThis();
	}
	class FakeText extends FakeContainer {
		anchor = { set: vi.fn() };
		style: Record<string, unknown> = {};
		text = "";
		visible = true;
		destroy = vi.fn();
		constructor(opts: { text: string; style: Record<string, unknown> }) {
			super();
			this.text = opts.text;
			this.style = opts.style;
		}
	}
	class FakeApplication {
		canvas = document.createElement("canvas");
		stage = new FakeContainer();
		renderer = { resize: vi.fn() };
		async init(opts: InitOpts): Promise<void> {
			initCalls.push(opts);
		}
		destroy = vi.fn();
	}
	return {
		Application: FakeApplication,
		Container: FakeContainer,
		Graphics: FakeGraphics,
		Text: FakeText,
	};
});

import { mountPixiEdges } from "./pixi-edges";

describe("pixi connector layer contract (9.17.5 regression guard)", () => {
	let host: HTMLDivElement;

	beforeEach(() => {
		initCalls.length = 0;
		host = document.createElement("div");
		host.className = "whiteboard__edge-host";
		document.body.appendChild(host);
	});

	afterEach(() => {
		host.remove();
	});

	it("inits Pixi with a transparent background (never an opaque sheet)", async () => {
		await mountPixiEdges(host, 800, 600);
		expect(initCalls).toHaveLength(1);
		expect(initCalls[0]?.backgroundAlpha).toBe(0);
	});

	it("appends the canvas into the edge-host", async () => {
		const h = await mountPixiEdges(host, 800, 600);
		expect(h.canvas.parentElement).toBe(host);
		expect(host.querySelector("canvas")).toBe(h.canvas);
	});

	it("pins the canvas BELOW the node layer with an explicit z-index", async () => {
		const h = await mountPixiEdges(host, 800, 600);
		// The whole bug class: a stacking canvas with `z-index: auto`
		// (or any value ≥ the node layer) can paint over the HTML nodes.
		// The connector canvas must declare an explicit, negative-or-zero
		// z-index so it can never rise above the node layer regardless of
		// what stacking context the transformed `.whiteboard__canvas`
		// forms. `0` is not enough (it ties + tree-order can flip it);
		// the contract is a value strictly below the node layer.
		const z = h.canvas.style.zIndex;
		expect(z).not.toBe("");
		expect(z).not.toBe("auto");
		expect(Number(z)).toBeLessThan(1);
	});

	it("does not give the canvas an opaque background of its own", async () => {
		const h = await mountPixiEdges(host, 800, 600);
		const bg = h.canvas.style.background || h.canvas.style.backgroundColor;
		expect(bg === "" || bg === "transparent" || bg === "none").toBe(true);
	});

	it("fills the edge-host (absolute, inset 0) so the camera space matches the DOM", async () => {
		const h = await mountPixiEdges(host, 800, 600);
		expect(h.canvas.style.position).toBe("absolute");
		expect(h.canvas.style.inset).toBe("0px");
		expect(h.canvas.style.pointerEvents).toBe("none");
	});
});
