// @vitest-environment jsdom
/**
 * KBN-A-database (list view) — the row list's composite-keyboard contract:
 * the `<ul>` is a single-tab-stop listbox (`aria-activedescendant`), ArrowDown/Up
 * move the selection cursor row-to-row, and Enter opens. Dispatched on the
 * container; the reducer fires `onSelect`/`onOpen` by index, so per-row virtual
 * rendering (perf-CI) isn't needed to verify the wiring.
 */

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompiledView } from "../logic/compile-view";
import type { EntityRow } from "../logic/in-memory-entities";
import type { ListLayoutOptions } from "../types/list-view";
import { ListView, type ListViewProps } from "./list-view";

const LAYOUT: ListLayoutOptions = { density: "comfortable", showIcon: false };

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

function mountList(props: Partial<ListViewProps>): Harness {
	const container = document.createElement("div");
	const stage = document.createElement("div");
	stage.className = "db-stage__body";
	stage.style.height = "400px";
	stage.append(container);
	document.body.append(stage);
	const root: Root = createRoot(container);
	act(() =>
		root.render(
			<ListView
				compiled={COMPILED}
				columns={[]}
				layout={LAYOUT}
				selectedIds={new Set(["a"])}
				onSelect={vi.fn()}
				onOpen={vi.fn()}
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
			stage.remove();
		},
	};
}

function press(node: HTMLElement, key: string): void {
	act(() => {
		node.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
	});
}

describe("ListView keyboard (KBN-A-database)", () => {
	let h: Harness | null = null;
	afterEach(() => {
		h?.cleanup();
		h = null;
		document.body.innerHTML = "";
	});

	it("renders the rows as a single-tab-stop listbox", () => {
		h = mountList({});
		expect(h.listbox.getAttribute("role")).toBe("listbox");
		expect(h.listbox.getAttribute("tabindex")).toBe("0");
	});

	it("ArrowDown moves the selection cursor to the next row (single-select)", () => {
		const onSelect = vi.fn();
		h = mountList({ selectedIds: new Set(["a"]), onSelect });
		press(h.listbox, "ArrowDown");
		expect(onSelect).toHaveBeenCalledWith(COMPILED.rows[1], { shiftKey: false, metaKey: false });
	});

	it("ArrowUp moves the cursor to the previous row", () => {
		const onSelect = vi.fn();
		h = mountList({ selectedIds: new Set(["b"]), onSelect });
		press(h.listbox, "ArrowUp");
		expect(onSelect).toHaveBeenCalledWith(COMPILED.rows[0], { shiftKey: false, metaKey: false });
	});

	it("Enter opens the active row", () => {
		const onOpen = vi.fn();
		h = mountList({ selectedIds: new Set(["b"]), onOpen });
		press(h.listbox, "Enter");
		expect(onOpen).toHaveBeenCalledWith(COMPILED.rows[1]);
	});
});
