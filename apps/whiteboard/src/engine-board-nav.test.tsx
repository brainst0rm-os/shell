// @vitest-environment jsdom
/**
 * Board back/forward history — the header `<NavButtons>` affordance.
 *
 * Regression for the dogfood defect where the control was permanently
 * disabled: app.tsx fed it a local history nothing pushed to, while the
 * engine kept a SEPARATE history (never consumed) and an `applyingNavHistory`
 * flag that was `const false` (never reassigned). These pin the now-wired
 * contract:
 *   1. opening boards pushes onto `boardNav` (so the buttons enable);
 *   2. `goBoardBack` / `goBoardForward` actually OPEN the prev/next board;
 *   3. stepping back/forward does NOT re-record (the guard holds) — so a
 *      back→forward round-trip lands where you started, forward stays usable;
 *   4. `applyBoardLocation` (NavButtons' `onNavigate`) applies without pushing.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type WhiteboardEngine, createWhiteboardEngine } from "./engine";
import { BoardTemplate } from "./logic/templates";

let engine: WhiteboardEngine | null = null;
let hosts: HTMLDivElement[] = [];

function mountHosts() {
	const make = (cls: string): HTMLDivElement => {
		const el = document.createElement("div");
		el.className = cls;
		document.body.appendChild(el);
		hosts.push(el);
		return el;
	};
	return {
		root: make("whiteboard-root"),
		canvas: make("canvas"),
		layers: make("layers"),
		navList: make("nav-list"),
	};
}

beforeEach(() => {
	engine = createWhiteboardEngine(mountHosts());
});

afterEach(() => {
	engine?.dispose();
	engine = null;
	for (const el of hosts) el.remove();
	hosts = [];
	window.brainstorm = undefined;
});

function currentBoardId(): string {
	return engine?.getSnapshot().boardId ?? "";
}

describe("whiteboard board back/forward history", () => {
	it("opening boards pushes onto the shared boardNav (buttons enable)", () => {
		const e = engine;
		if (!e) throw new Error("no engine");
		const nav = e.boardNav();
		expect(nav.canGoBack()).toBe(false);

		e.createNewBoard(BoardTemplate.Blank);
		const first = currentBoardId();
		expect(first).not.toBe("");
		// First open replaces the empty seed — still no back entry.
		expect(nav.canGoBack()).toBe(false);

		e.createNewBoard(BoardTemplate.Blank);
		const second = currentBoardId();
		expect(second).not.toBe(first);
		expect(nav.canGoBack()).toBe(true);
		expect(nav.current()).toBe(second);
	});

	it("goBoardBack / goBoardForward open the previous / next board", () => {
		const e = engine;
		if (!e) throw new Error("no engine");
		e.createNewBoard(BoardTemplate.Blank);
		const a = currentBoardId();
		e.createNewBoard(BoardTemplate.Blank);
		const b = currentBoardId();

		e.goBoardBack();
		expect(currentBoardId()).toBe(a);
		expect(e.boardNav().canGoForward()).toBe(true);

		e.goBoardForward();
		expect(currentBoardId()).toBe(b);
		expect(e.boardNav().canGoForward()).toBe(false);
	});

	it("stepping back does not re-record — forward stays available", () => {
		const e = engine;
		if (!e) throw new Error("no engine");
		e.createNewBoard(BoardTemplate.Blank);
		const a = currentBoardId();
		e.createNewBoard(BoardTemplate.Blank);
		const b = currentBoardId();

		e.goBoardBack();
		// If the guard failed, opening `a` here would have pushed and cleared
		// the forward stack.
		expect(e.boardNav().canGoForward()).toBe(true);
		e.goBoardForward();
		expect(currentBoardId()).toBe(b);
		expect(e.boardNav().canGoBack()).toBe(true);
		expect(currentBoardId()).toBe(b);
		expect(a).not.toBe(b);
	});

	it("applyBoardLocation (NavButtons onNavigate) applies without pushing", () => {
		const e = engine;
		if (!e) throw new Error("no engine");
		e.createNewBoard(BoardTemplate.Blank);
		const a = currentBoardId();
		e.createNewBoard(BoardTemplate.Blank);
		const b = currentBoardId();
		const nav = e.boardNav();

		// Simulate what NavButtons does: step the history itself, then hand the
		// returned id to onNavigate (applyBoardLocation) which must NOT push.
		const stepped = nav.back();
		expect(stepped).toBe(a);
		e.applyBoardLocation(a);
		expect(currentBoardId()).toBe(a);
		expect(nav.canGoForward()).toBe(true);
		expect(nav.current()).toBe(a);
	});

	it("a new board open after stepping back clears the forward trail", () => {
		const e = engine;
		if (!e) throw new Error("no engine");
		e.createNewBoard(BoardTemplate.Blank);
		e.createNewBoard(BoardTemplate.Blank);
		e.goBoardBack();
		expect(e.boardNav().canGoForward()).toBe(true);
		e.createNewBoard(BoardTemplate.Blank);
		// A genuine user open re-records and discards the forward stack.
		expect(e.boardNav().canGoForward()).toBe(false);
	});
});
