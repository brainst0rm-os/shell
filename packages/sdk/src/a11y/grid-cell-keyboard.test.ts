// @vitest-environment jsdom
/**
 * `attachGridCellKeyboard` / `attachOrderedGridCellKeyboard` — index-aligned
 * cell list, grid/gridcell role stamping, arrow-driven aria-activedescendant,
 * Enter-opens-active, one-Tab-stop demotion, and column-major→row-major
 * navigation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachGridCellKeyboard, attachOrderedGridCellKeyboard } from "./grid-cell-keyboard";

let grid: HTMLElement;

function buildGrid(count: number): HTMLElement {
	const el = document.createElement("div");
	for (let i = 0; i < count; i++) {
		const cell = document.createElement("div");
		cell.className = "cell";
		cell.dataset.dateEpochMs = String(i);
		const btn = document.createElement("button");
		btn.type = "button";
		cell.appendChild(btn);
		el.appendChild(cell);
	}
	document.body.appendChild(el);
	return el;
}

beforeEach(() => {
	grid = buildGrid(42); // 6 weeks × 7
});
afterEach(() => {
	grid.remove();
});

describe("attachGridCellKeyboard (DOM order = row-major)", () => {
	it("stamps an index-aligned grid + gridcell roles and one Tab stop", () => {
		attachGridCellKeyboard(grid, ".cell", { columns: 7, onOpenCell: () => {} });
		expect(grid.getAttribute("role")).toBe("grid");
		expect(grid.tabIndex).toBe(0);
		const cells = grid.querySelectorAll<HTMLElement>(".cell");
		expect(cells[0]?.getAttribute("role")).toBe("gridcell");
		expect(cells[0]?.dataset.compositeIndex).toBe("0");
		expect(cells[41]?.dataset.compositeIndex).toBe("41");
		expect(cells[0]?.querySelector("button")?.tabIndex).toBe(-1);
	});

	it("tracks the active cell via aria-activedescendant from the initial index", () => {
		attachGridCellKeyboard(grid, ".cell", { columns: 7, onOpenCell: () => {}, initialIndex: 8 });
		const cell8 = grid.querySelectorAll<HTMLElement>(".cell")[8];
		expect(grid.getAttribute("aria-activedescendant")).toBe(cell8?.id);
	});

	it("moves a full row on ArrowDown and one column on ArrowRight", () => {
		attachGridCellKeyboard(grid, ".cell", { columns: 7, onOpenCell: () => {}, initialIndex: 0 });
		grid.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
		expect(grid.getAttribute("aria-activedescendant")).toBe(
			grid.querySelectorAll<HTMLElement>(".cell")[7]?.id,
		);
		grid.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
		expect(grid.getAttribute("aria-activedescendant")).toBe(
			grid.querySelectorAll<HTMLElement>(".cell")[8]?.id,
		);
	});

	it("opens the active cell on Enter", () => {
		const onOpenCell = vi.fn();
		attachGridCellKeyboard(grid, ".cell", { columns: 7, onOpenCell, initialIndex: 5 });
		grid.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		expect(onOpenCell).toHaveBeenCalledTimes(1);
		expect((onOpenCell.mock.calls[0]?.[0] as HTMLElement).dataset.dateEpochMs).toBe("5");
		expect(onOpenCell.mock.calls[0]?.[1]).toBe(5);
	});

	it("clamps an out-of-range initial index", () => {
		attachGridCellKeyboard(grid, ".cell", { columns: 7, onOpenCell: () => {}, initialIndex: 999 });
		expect(grid.getAttribute("aria-activedescendant")).toBe(
			grid.querySelectorAll<HTMLElement>(".cell")[41]?.id,
		);
	});
});

describe("attachOrderedGridCellKeyboard (column-major DOM, row-major nav)", () => {
	let el: HTMLElement;
	let slots: HTMLButtonElement[];

	beforeEach(() => {
		el = document.createElement("div");
		slots = [];
		// 2 days × 3 hours, DOM column-major: d0h0 d0h1 d0h2 d1h0 d1h1 d1h2
		for (let d = 0; d < 2; d++) {
			for (let h = 0; h < 3; h++) {
				const b = document.createElement("button");
				b.type = "button";
				b.dataset.tag = `d${d}h${h}`;
				el.appendChild(b);
				slots.push(b);
			}
		}
		document.body.appendChild(el);
	});
	afterEach(() => el.remove());

	function ordered(): HTMLButtonElement[] {
		// row-major: [d0h0, d1h0, d0h1, d1h1, d0h2, d1h2]
		const out: HTMLButtonElement[] = [];
		for (let h = 0; h < 3; h++)
			for (let d = 0; d < 2; d++) out.push(slots[d * 3 + h] as HTMLButtonElement);
		return out;
	}
	const tagOf = (id: string | null) => el.querySelector(`#${id}`)?.getAttribute("data-tag");

	it("ArrowRight → next day, ArrowDown → next hour", () => {
		attachOrderedGridCellKeyboard(el, ordered(), {
			columns: 2,
			onOpenCell: () => {},
			initialIndex: 0,
		});
		expect(tagOf(el.getAttribute("aria-activedescendant"))).toBe("d0h0");
		el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
		expect(tagOf(el.getAttribute("aria-activedescendant"))).toBe("d1h0");
		el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
		el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
		expect(tagOf(el.getAttribute("aria-activedescendant"))).toBe("d0h1");
	});

	it("Enter opens the active slot regardless of DOM order", () => {
		const onOpenCell = vi.fn();
		attachOrderedGridCellKeyboard(el, ordered(), { columns: 2, onOpenCell, initialIndex: 3 });
		el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		expect((onOpenCell.mock.calls[0]?.[0] as HTMLElement).dataset.tag).toBe("d1h1");
	});

	it("demotes the slot buttons out of the Tab order (one Tab stop)", () => {
		attachOrderedGridCellKeyboard(el, ordered(), { columns: 2, onOpenCell: () => {} });
		expect(el.tabIndex).toBe(0);
		for (const s of slots) expect(s.tabIndex).toBe(-1);
	});
});
