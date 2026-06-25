// @vitest-environment jsdom
/**
 * F-213 regression — the double-click → spawn → type pipeline, driven
 * through the real engine behind `<WhiteboardApp>`.
 *
 * The dogfood failure: a bare-canvas double-click created NOTHING, so the
 * typed head fell through to the window-level S/T/F creation chords —
 * "Launch narrat" vanished and the first `t` spawned a stray node. Pinned
 * here:
 *   1. a bare-canvas dblclick spawns a sticky whose inline editor owns the
 *      keyboard synchronously (same task — no focus-handoff window);
 *   2. printable chord keys aimed at the editor stay in the editor;
 *   3. while an edit is pending-or-active the creation chords are dead even
 *      when the keystroke's target is not the editor (fail-closed guard);
 *   4. the sanctioned S-chord flow (pointer move → S → type) still works,
 *      and the chords revive once the edit commits;
 *   5. an edge double-click still wins over spawn (label editing intact),
 *      and an open edge-label edit suppresses the chords too.
 */

import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { WhiteboardApp } from "./app";
import { flush, renderInto } from "./test/render";

let handle: Awaited<ReturnType<typeof renderInto>> | null = null;

afterEach(async () => {
	await handle?.unmount();
	handle = null;
	window.brainstorm = undefined;
	Reflect.deleteProperty(window, "__brainstormWhiteboardDev");
});

type Surface = {
	wrap: HTMLElement;
	canvas: HTMLElement;
	nodes: () => HTMLElement[];
	editingBody: () => HTMLElement | null;
};

async function mountSurface(): Promise<Surface> {
	handle = await renderInto(<WhiteboardApp />);
	await flush();
	const container = handle.container;
	const wrap = container.querySelector<HTMLElement>(".whiteboard__canvas-wrap");
	const canvas = container.querySelector<HTMLElement>(".whiteboard__canvas");
	if (!wrap || !canvas) throw new Error("canvas surface did not mount");
	return {
		wrap,
		canvas,
		nodes: () => Array.from(container.querySelectorAll<HTMLElement>(".whiteboard__node")),
		editingBody: () => container.querySelector<HTMLElement>(".whiteboard__node-body--editing"),
	};
}

function dblclickAt(el: HTMLElement, x: number, y: number): void {
	act(() => {
		el.dispatchEvent(
			new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: x, clientY: y }),
		);
	});
}

function keydown(target: EventTarget, key: string, init: KeyboardEventInit = {}): void {
	act(() => {
		target.dispatchEvent(
			new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
		);
	});
}

/** CmdOrCtrl+Enter — jsdom is non-mac, so Ctrl. */
function commitChord(target: EventTarget): void {
	keydown(target, "Enter", { ctrlKey: true });
}

describe("F-213 — double-click-to-create owns the keyboard", () => {
	it("spawns a sticky in inline edit on a bare-canvas dblclick, focused synchronously", async () => {
		const s = await mountSurface();
		expect(s.nodes().length).toBe(0);
		dblclickAt(s.canvas, 200, 150);
		const all = s.nodes();
		expect(all.length).toBe(1);
		expect(all[0]?.classList.contains("whiteboard__node--sticky")).toBe(true);
		expect(all[0]?.style.left).toBe("200px");
		expect(all[0]?.style.top).toBe("150px");
		const body = s.editingBody();
		expect(body).not.toBeNull();
		expect(body?.getAttribute("contenteditable")).toBe("true");
		// Focus handed over in the SAME task as the spawn — the head-loss
		// window does not exist.
		expect(document.activeElement).toBe(body);
	});

	it("printable chord keys aimed at the editor stay in the editor — no stray nodes", async () => {
		const s = await mountSurface();
		dblclickAt(s.canvas, 200, 150);
		const body = s.editingBody();
		expect(body).not.toBeNull();
		if (!body) return;
		for (const key of ["s", "t", "f"]) keydown(body, key);
		expect(s.nodes().length).toBe(1);
	});

	it("creation chords are dead while the edit is active even when focus escaped", async () => {
		const s = await mountSurface();
		dblclickAt(s.canvas, 200, 150);
		// Worst case: the edit exists but the keystroke no longer targets the
		// editor (window-level delivery) — the state guard must hold.
		keydown(window, "s");
		keydown(document.body, "t");
		keydown(document.body, "f");
		expect(s.nodes().length).toBe(1);
	});

	it("a second bare-canvas dblclick while an edit is still open spawns nothing", async () => {
		// In a real browser the first click of the second dblclick blurs and
		// commits the open edit, so a fresh sticky correctly spawns; jsdom
		// skips the blur, which is exactly the pending-edit window the guard
		// must fail closed in.
		const s = await mountSurface();
		dblclickAt(s.canvas, 200, 150);
		dblclickAt(s.canvas, 600, 400);
		expect(s.nodes().length).toBe(1);
	});

	it("a dblclick on the node already mid-edit never re-seeds the editor (typed text kept)", async () => {
		const s = await mountSurface();
		dblclickAt(s.canvas, 200, 150);
		const body = s.editingBody();
		expect(body).not.toBeNull();
		if (!body) return;
		act(() => {
			body.textContent = "half-typed";
		});
		// Bubbles to the node element's own dblclick handler (beginEdit).
		dblclickAt(body, 210, 160);
		expect(s.editingBody()?.textContent).toBe("half-typed");
		expect(s.nodes().length).toBe(1);
	});

	it("the full typed string commits into the dblclick-spawned sticky", async () => {
		const s = await mountSurface();
		dblclickAt(s.canvas, 200, 150);
		const body = s.editingBody();
		expect(body).not.toBeNull();
		if (!body) return;
		// jsdom cannot synthesize text insertion from keydown; the keydown
		// streams above prove chord transparency, the DOM write stands in
		// for the inserted characters.
		act(() => {
			body.textContent = "Launch narrative — bold the stakes";
		});
		commitChord(body);
		await flush();
		const all = s.nodes();
		expect(all.length).toBe(1);
		expect(all[0]?.querySelector(".whiteboard__node-body")?.textContent).toBe(
			"Launch narrative — bold the stakes",
		);
	});

	it("the S-chord flow still spawns at the pointer and chords revive after commit", async () => {
		const s = await mountSurface();
		act(() => {
			s.wrap.dispatchEvent(
				new MouseEvent("pointermove", { bubbles: true, clientX: 300, clientY: 220 }),
			);
		});
		keydown(document.body, "s");
		const all = s.nodes();
		expect(all.length).toBe(1);
		expect(all[0]?.style.left).toBe("300px");
		expect(all[0]?.style.top).toBe("220px");
		const body = s.editingBody();
		expect(body).not.toBeNull();
		expect(document.activeElement).toBe(body);
		if (!body) return;
		keydown(body, "t");
		expect(s.nodes().length).toBe(1);
		commitChord(body);
		await flush();
		// The edit is resolved — creation chords are live again.
		keydown(document.body, "t");
		expect(s.nodes().length).toBe(2);
	});

	it("an edge dblclick opens the label editor (not a spawn) and suppresses the chords", async () => {
		const s = await mountSurface();
		keydown(document.body, "s");
		const firstBody = s.editingBody();
		expect(firstBody).not.toBeNull();
		if (!firstBody) return;
		commitChord(firstBody);
		await flush();
		keydown(document.body, "s");
		const secondBody = s.editingBody();
		expect(secondBody).not.toBeNull();
		if (!secondBody) return;
		commitChord(secondBody);
		await flush();
		const dev = window.__brainstormWhiteboardDev;
		expect(dev).toBeDefined();
		if (!dev) return;
		const [aId, bId] = dev.nodeIds();
		expect(aId).toBeDefined();
		expect(bId).toBeDefined();
		if (!aId || !bId) return;
		let moved: { x: number; y: number } = { x: 0, y: 0 };
		let edgeId: string | null = null;
		act(() => {
			moved = dev.dragNodeBy(bId, 376, -24);
			dev.endDrag();
			edgeId = dev.connect(aId, bId);
		});
		expect(edgeId).not.toBeNull();
		// Geometry precondition: A at (0,0) 180×180, B dragged level with it,
		// so the step edge runs straight from (180, 90) to (moved.x, 90).
		expect(moved.y).toBe(0);
		dblclickAt(s.canvas, (180 + moved.x) / 2, 90);
		expect(s.nodes().length).toBe(2);
		const labelInput = handle?.container.querySelector(".whiteboard__edge-label-input");
		expect(labelInput).not.toBeNull();
		// The open edge-label edit is `editingActive` too — chords stay dead.
		keydown(document.body, "s");
		expect(s.nodes().length).toBe(2);
	});
});
