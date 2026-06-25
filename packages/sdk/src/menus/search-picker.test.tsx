// @vitest-environment jsdom
/**
 * Tests for `openSearchPicker` — the shared filter-input-over-a-list picker.
 * Asserts the picker opens with the initial filtered set, that typing into the
 * chrome filter re-runs the host filter and swaps the list IN PLACE (host owns
 * ranking — no runtime substring re-filter), that a row click commits by id and
 * closes, that the empty-state (disabled) row never commits, and that `onClose`
 * fires once on close.
 */

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrainstormMenuProvider, getActiveMenuStore } from "../menus";
import {
	SEARCH_PICKER_ID,
	type SearchPickerItem,
	closeSearchPicker,
	openSearchPicker,
} from "./search-picker";

const ALL: SearchPickerItem[] = [
	{ id: "1", label: "Roadmap", caption: "Note" },
	{ id: "2", label: "Road trip", caption: "Note" },
	{ id: "3", label: "Budget", caption: "Database" },
];

/** Host filter: substring on label, or a single disabled empty-state row. */
function hostFilter(query: string): SearchPickerItem[] {
	const q = query.trim().toLowerCase();
	const hits = q ? ALL.filter((i) => i.label.toLowerCase().includes(q)) : ALL;
	return hits.length > 0 ? hits : [{ id: "__empty", label: "No results", disabled: true }];
}

function openMenu() {
	const store = getActiveMenuStore();
	const open = store?.getAll().find((m) => m.id === SEARCH_PICKER_ID);
	return { store, open };
}

function items(): SearchPickerItem[] {
	return ((openMenu().open?.param.data as SearchPickerData | undefined)?.items ?? []).slice();
}
type SearchPickerData = { items: SearchPickerItem[] };

/** Drive the chrome filter input the way `FilterInput` does on a keystroke. */
function type(query: string): void {
	const { open } = openMenu();
	const filter = (open?.config.chrome as { filter: { onChange: (v: string) => void } }).filter;
	act(() => filter.onChange(query));
}

/** Fire a row's onClick with a ctx whose `closeAll` closes the live menu. */
function clickRow(label: string): void {
	const { store, open } = openMenu();
	const item = items().find((i) => i.label === label);
	const spec = (
		open?.config.body as {
			rows: ReadonlyArray<{
				onClick: (i: SearchPickerItem, e: unknown, ctx: { closeAll: () => void }) => void;
			}>;
		}
	).rows[0];
	act(() =>
		spec?.onClick(item as SearchPickerItem, new MouseEvent("click"), {
			closeAll: () => store?.close(open?.id),
		}),
	);
}

describe("search-picker", () => {
	let host: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		// The store closes menus behind a close-animation timer, so onClose (a
		// MenuView effect-cleanup) is deferred — fake timers let the close-timing
		// assertions flush it deterministically. React 18 schedules off
		// microtasks, not setTimeout, so faking timers doesn't stall rendering.
		vi.useFakeTimers();
		host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
		act(() =>
			root.render(
				<BrainstormMenuProvider>
					<div />
				</BrainstormMenuProvider>,
			),
		);
	});
	afterEach(() => {
		act(() => closeSearchPicker());
		act(() => vi.runAllTimers());
		act(() => root.unmount());
		host.remove();
		vi.useRealTimers();
	});

	/** Flush the close-animation timer so the menu unmounts + `onClose` fires. */
	function flushClose(): void {
		act(() => vi.runAllTimers());
	}

	function open(overrides: Partial<Parameters<typeof openSearchPicker>[0]> = {}) {
		const anchor = document.createElement("button");
		document.body.appendChild(anchor);
		const selected: string[] = [];
		const closes: number[] = [];
		act(() => {
			openSearchPicker({
				placeholder: "Search to embed…",
				ariaLabel: "Embed entity",
				filter: hostFilter,
				onSelect: (id) => selected.push(id),
				onClose: () => closes.push(1),
				anchor,
				...overrides,
			});
		});
		return { selected, closes };
	}

	it("opens with the full set and re-runs the host filter as the query changes", () => {
		open();
		expect(items().map((i) => i.label)).toEqual(["Roadmap", "Road trip", "Budget"]);

		type("road");
		// Host ranking is preserved verbatim — no runtime substring re-filter.
		expect(items().map((i) => i.label)).toEqual(["Roadmap", "Road trip"]);

		type("budget");
		expect(items().map((i) => i.id)).toEqual(["3"]);
	});

	it("renders a single disabled empty-state row when the filter is empty", () => {
		open();
		type("zzz");
		expect(items()).toEqual([{ id: "__empty", label: "No results", disabled: true }]);
	});

	it("commits a row by id and closes (firing onClose once)", () => {
		const { selected, closes } = open();
		clickRow("Road trip");
		expect(selected).toEqual(["2"]);
		flushClose();
		expect(openMenu().open, "menu closes after a commit").toBeUndefined();
		expect(closes).toEqual([1]);
	});

	it("never commits the disabled empty-state row", () => {
		const { selected } = open();
		type("zzz");
		clickRow("No results");
		expect(selected).toEqual([]);
		expect(openMenu().open, "menu stays open after clicking the empty row").toBeDefined();
	});

	it("fires onClose once on an explicit close", () => {
		const { closes } = open();
		act(() => closeSearchPicker());
		flushClose();
		expect(closes).toEqual([1]);
	});

	it("respects initialQuery for the first paint", () => {
		open({ initialQuery: "road" });
		expect(items().map((i) => i.label)).toEqual(["Roadmap", "Road trip"]);
	});
});
