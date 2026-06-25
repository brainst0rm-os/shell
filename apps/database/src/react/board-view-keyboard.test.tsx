// @vitest-environment jsdom
/**
 * KBN-A-database (board view) — each Kanban column's card stack is its own
 * vertical listbox: the column body is a single-tab-stop `listbox`
 * (`aria-activedescendant`), ArrowDown/Up move the cursor card-to-card within
 * the column, and Enter opens. Dispatched on the column container; the reducer
 * fires `onSelect`/`onOpen` by index, so per-card virtual rendering (perf-CI)
 * isn't needed to verify the wiring. Mirrors the list-view test.
 *
 * With no `compiled.groups`, the board renders a single "All" column holding
 * every row — enough to exercise the per-column keyboard contract.
 */

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompiledView } from "../logic/compile-view";
import type { EntityRow } from "../logic/in-memory-entities";
import type { BoardLayoutOptions, GroupBy } from "../types/list-view";
import { BoardView, type BoardViewProps } from "./board-view";

const LAYOUT: BoardLayoutOptions = {
	columnWidth: 280,
	collapseEmptyColumns: false,
	cardPreview: "minimal",
};

const GROUP_BY: GroupBy = { propertyId: "status" };

function row(id: string): EntityRow {
	return {
		id,
		type: "brainstorm/Task/v1",
		properties: { title: id },
		createdAt: 0,
		updatedAt: 0,
		deletedAt: null,
	};
}

const COMPILED: CompiledView = { rows: [row("a"), row("b"), row("c")], groups: [] };

type Harness = { listbox: HTMLElement; cleanup: () => void };

function mountBoard(props: Partial<BoardViewProps>): Harness {
	const container = document.createElement("div");
	document.body.append(container);
	const root: Root = createRoot(container);
	act(() =>
		root.render(
			<BoardView
				compiled={COMPILED}
				columns={[]}
				layout={LAYOUT}
				groupBy={GROUP_BY}
				subtitleProperty={null}
				selectedIds={new Set(["a"])}
				onSelect={vi.fn()}
				onOpen={vi.fn()}
				onMoveToGroup={vi.fn()}
				{...props}
			/>,
		),
	);
	const listbox = container.querySelector<HTMLElement>('[role="listbox"]');
	if (!listbox) throw new Error("listbox not rendered");
	return {
		listbox,
		cleanup: () => {
			act(() => root.unmount());
			container.remove();
		},
	};
}

function press(node: HTMLElement, key: string): void {
	act(() => {
		node.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
	});
}

describe("BoardView keyboard (KBN-A-database)", () => {
	let h: Harness | null = null;
	afterEach(() => {
		h?.cleanup();
		h = null;
		document.body.innerHTML = "";
	});

	it("renders the column card stack as a single-tab-stop listbox", () => {
		h = mountBoard({});
		expect(h.listbox.getAttribute("role")).toBe("listbox");
		expect(h.listbox.getAttribute("tabindex")).toBe("0");
	});

	it("ArrowDown moves the selection cursor to the next card in the column (single-select)", () => {
		const onSelect = vi.fn();
		h = mountBoard({ selectedIds: new Set(["a"]), onSelect });
		press(h.listbox, "ArrowDown");
		expect(onSelect).toHaveBeenCalledWith(COMPILED.rows[1], { shiftKey: false, metaKey: false });
	});

	it("ArrowUp moves the cursor to the previous card", () => {
		const onSelect = vi.fn();
		h = mountBoard({ selectedIds: new Set(["b"]), onSelect });
		press(h.listbox, "ArrowUp");
		expect(onSelect).toHaveBeenCalledWith(COMPILED.rows[0], { shiftKey: false, metaKey: false });
	});

	it("Enter opens the active card", () => {
		const onOpen = vi.fn();
		h = mountBoard({ selectedIds: new Set(["b"]), onOpen });
		press(h.listbox, "Enter");
		expect(onOpen).toHaveBeenCalledWith(COMPILED.rows[1]);
	});
});
