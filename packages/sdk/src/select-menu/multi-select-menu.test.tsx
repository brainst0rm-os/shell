// @vitest-environment jsdom
/**
 * Tests for `openMultiSelectMenu` / `<MultiSelectMenu>` — the keep-open,
 * multi-toggle sibling of the select control. Asserts the popup renders one
 * check-bearing row per option, that a click toggles selection IN PLACE
 * (the menu's data updates, it does NOT close) and reports the full next id
 * set, and that the trigger summarises the current selection.
 */

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	BrainstormMenuProvider,
	type MenuCtx,
	closeContextMenu,
	getActiveMenuStore,
} from "../menus";
import { MultiSelectMenu } from "./multi-select-menu";
import { openMultiSelectMenu } from "./open-multi-select-menu";

const OPTIONS = [
	{ id: "a", label: "Alpha" },
	{ id: "b", label: "Beta" },
	{ id: "c", label: "Gamma" },
] as const;

type Row = { id: string; label: string; selected: boolean };
type RowClick = (item: Row, e: unknown, ctx: Pick<MenuCtx, "updateData">) => void;

function openMenu() {
	const store = getActiveMenuStore();
	const open = store?.getAll().find((m) => m.id.startsWith("bs/multi-select-menu"));
	return { store, open };
}

function rows(): Row[] {
	const { open } = openMenu();
	return (open?.param.data as { rows: Row[] }).rows;
}

/** Fire a row's keep-open onClick with a ctx that forwards `updateData` to the
 *  live store, exactly like the runtime does on a real click. */
function clickRow(label: string): void {
	const { store, open } = openMenu();
	const row = rows().find((r) => r.label === label);
	const spec = (open?.config.body as { rows: ReadonlyArray<{ onClick: RowClick }> }).rows[0];
	act(() =>
		spec?.onClick(row as Row, new MouseEvent("click"), {
			updateData: (patch) => store?.updateData(open?.id ?? "", patch),
		}),
	);
}

describe("multi-select-menu", () => {
	let host: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
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
		act(() => closeContextMenu());
		act(() => root.unmount());
		host.remove();
	});

	it("renders a row per option with checks on the selected ones", () => {
		const anchor = document.createElement("button");
		document.body.appendChild(anchor);
		act(() => {
			openMultiSelectMenu({
				anchor,
				menuLabel: "Links to",
				options: OPTIONS,
				selected: ["b"],
				onChange: () => undefined,
			});
		});
		expect(rows().map((r) => r.label)).toEqual(["Alpha", "Beta", "Gamma"]);
		expect(
			rows()
				.filter((r) => r.selected)
				.map((r) => r.id),
		).toEqual(["b"]);
	});

	it("toggles a row in place and reports the next id set without closing", () => {
		const anchor = document.createElement("button");
		document.body.appendChild(anchor);
		const changes: string[][] = [];
		act(() => {
			openMultiSelectMenu({
				anchor,
				menuLabel: "Links to",
				options: OPTIONS,
				selected: ["b"],
				onChange: (next) => changes.push([...next]),
			});
		});

		clickRow("Alpha");
		expect(changes.at(-1)).toEqual(["a", "b"]);
		// The menu stays open with the new check painted.
		expect(openMenu().open, "menu stays open after a toggle").toBeDefined();
		expect(
			rows()
				.filter((r) => r.selected)
				.map((r) => r.id)
				.sort(),
		).toEqual(["a", "b"]);

		clickRow("Beta");
		expect(changes.at(-1)).toEqual(["a"]);
		expect(
			rows()
				.filter((r) => r.selected)
				.map((r) => r.id),
		).toEqual(["a"]);
	});

	it("trigger summarises the selection and uses the placeholder when empty", () => {
		const triggerHost = document.createElement("div");
		document.body.appendChild(triggerHost);
		const triggerRoot = createRoot(triggerHost);
		act(() =>
			triggerRoot.render(
				<MultiSelectMenu
					selected={[]}
					options={OPTIONS}
					onChange={() => undefined}
					ariaLabel="Links to"
					placeholder="Anything"
				/>,
			),
		);
		expect(triggerHost.querySelector(".bs-select__value")?.textContent).toBe("Anything");

		act(() =>
			triggerRoot.render(
				<MultiSelectMenu
					selected={["a", "b"]}
					options={OPTIONS}
					onChange={() => undefined}
					ariaLabel="Links to"
					placeholder="Anything"
				/>,
			),
		);
		expect(triggerHost.querySelector(".bs-select__value")?.textContent).toBe("Alpha, Beta");

		act(() =>
			triggerRoot.render(
				<MultiSelectMenu
					selected={["a", "b", "c"]}
					options={OPTIONS}
					onChange={() => undefined}
					ariaLabel="Links to"
					placeholder="Anything"
				/>,
			),
		);
		expect(triggerHost.querySelector(".bs-select__value")?.textContent).toBe("Alpha +2");
		act(() => triggerRoot.unmount());
		triggerHost.remove();
	});
});
