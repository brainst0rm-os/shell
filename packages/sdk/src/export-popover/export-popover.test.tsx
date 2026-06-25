/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTEXT_MENU_ID, type ContextMenuItem, getActiveMenuStore, mountMenuHost } from "../menus";
import { ExportOptionKind, type ExportPopoverSpec } from "./export-options";
import { type ExportPopoverResult, openExportPopover } from "./export-popover";

const spec: ExportPopoverSpec = {
	commonOptions: [
		{
			kind: ExportOptionKind.Checklist,
			id: "columns",
			label: "Columns",
			choices: [
				{ value: "a", label: "A" },
				{ value: "b", label: "B" },
			],
			default: ["a", "b"],
		},
	],
	formats: [
		{
			id: "csv",
			label: "CSV",
			options: [
				{ kind: ExportOptionKind.Toggle, id: "header", label: "Header row", default: true },
				{
					kind: ExportOptionKind.Select,
					id: "delimiter",
					label: "Delimiter",
					choices: [
						{ value: ",", label: "Comma" },
						{ value: "\t", label: "Tab" },
					],
					default: ",",
				},
			],
		},
		{
			id: "json",
			label: "JSON",
			options: [{ kind: ExportOptionKind.Toggle, id: "pretty", label: "Pretty-print", default: true }],
		},
	],
};

const labels = {
	title: "Export",
	formatLegend: "Format",
	exportAction: "Export",
	cancel: "Cancel",
};

function panel(): HTMLElement {
	return document.querySelector('[data-testid="export"]') as HTMLElement;
}

afterEach(() => {
	document.body.replaceChildren();
});

describe("openExportPopover", () => {
	it("renders a radio per format and the active format's options", () => {
		openExportPopover({ spec, labels, onExport: () => {}, testId: "export" });
		const radios = panel().querySelectorAll<HTMLInputElement>("input[type=radio]");
		expect([...radios].map((r) => r.value)).toEqual(["csv", "json"]);
		// CSV is the default → its options (header toggle + delimiter select) show.
		expect(panel().querySelector(".bs-select")).not.toBeNull();
		expect(panel().textContent).toContain("Header row");
	});

	it("exports the default values when Export is pressed", () => {
		const onExport = vi.fn<(r: ExportPopoverResult) => void>();
		openExportPopover({ spec, labels, onExport, testId: "export" });
		clickButton("Export");
		expect(onExport).toHaveBeenCalledTimes(1);
		expect(onExport.mock.calls[0]?.[0]).toEqual({
			formatId: "csv",
			values: { columns: ["a", "b"], header: true, delimiter: "," },
		});
	});

	it("reflects edits: untick a column, flip the toggle, change the delimiter", () => {
		let disposeMenus: () => void = () => {};
		act(() => {
			disposeMenus = mountMenuHost();
		});
		const onExport = vi.fn<(r: ExportPopoverResult) => void>();
		openExportPopover({ spec, labels, onExport, testId: "export" });

		check("b", false); // untick column B
		toggle("Header row");
		// The delimiter picker is the shared select control: click the trigger,
		// then pick "Tab" from the menu items published on the store.
		const trigger = panel().querySelector<HTMLButtonElement>(".bs-select");
		if (!trigger) throw new Error("delimiter select trigger not found");
		act(() => trigger.click());
		const open = getActiveMenuStore()
			?.getAll()
			.find((m) => m.id === `${CONTEXT_MENU_ID}:Delimiter`);
		const items = (open?.param.data as { items: ContextMenuItem[] }).items;
		act(() => items.find((item) => item.label === "Tab")?.onSelect?.());

		clickButton("Export");
		expect(onExport.mock.calls[0]?.[0]).toEqual({
			formatId: "csv",
			values: { columns: ["a"], header: false, delimiter: "\t" },
		});
		act(() => disposeMenus());
	});

	it("carries the common columns selection across a format switch and drops format-only options", () => {
		const onExport = vi.fn<(r: ExportPopoverResult) => void>();
		openExportPopover({ spec, labels, onExport, testId: "export" });
		check("a", false); // columns now ["b"]
		selectFormat("json");

		clickButton("Export");
		expect(onExport.mock.calls[0]?.[0]).toEqual({
			formatId: "json",
			values: { columns: ["b"], pretty: true },
		});
	});

	it("calls onCancel (not onExport) when Cancel is pressed", () => {
		const onExport = vi.fn();
		const onCancel = vi.fn();
		openExportPopover({ spec, labels, onExport, onCancel, testId: "export" });
		clickButton("Cancel");
		expect(onCancel).toHaveBeenCalledTimes(1);
		expect(onExport).not.toHaveBeenCalled();
		expect(panel()).toBeNull(); // closed
	});

	it("does not fire onCancel when Export closes the popover", () => {
		const onCancel = vi.fn();
		openExportPopover({ spec, labels, onExport: () => {}, onCancel, testId: "export" });
		clickButton("Export");
		expect(onCancel).not.toHaveBeenCalled();
	});

	it("disables Export until a requireOne checklist has a selection", () => {
		const requireSpec: ExportPopoverSpec = {
			commonOptions: [
				{
					kind: ExportOptionKind.Checklist,
					id: "columns",
					label: "Columns",
					choices: [{ value: "a", label: "A" }],
					default: ["a"],
					requireOne: true,
				},
			],
			formats: [{ id: "csv", label: "CSV" }],
		};
		openExportPopover({ spec: requireSpec, labels, onExport: () => {}, testId: "export" });
		const exportBtn = button("Export");
		expect(exportBtn.disabled).toBe(false);
		check("a", false);
		expect(exportBtn.disabled).toBe(true);
	});
});

function button(text: string): HTMLButtonElement {
	const btn = [...panel().querySelectorAll("button")].find((b) => b.textContent === text);
	if (!btn) throw new Error(`button "${text}" not found`);
	return btn as HTMLButtonElement;
}
function clickButton(text: string): void {
	button(text).click();
}
function check(value: string, checked: boolean): void {
	const input = panel().querySelector<HTMLInputElement>(`input[type=checkbox][value="${value}"]`);
	if (!input) throw new Error(`checkbox "${value}" not found`);
	input.checked = checked;
	input.dispatchEvent(new Event("change", { bubbles: true }));
}
function toggle(labelText: string): void {
	const label = [...panel().querySelectorAll("label")].find((l) =>
		l.textContent?.includes(labelText),
	);
	const input = label?.querySelector<HTMLInputElement>("input[type=checkbox]");
	if (!input) throw new Error(`toggle "${labelText}" not found`);
	input.checked = !input.checked;
	input.dispatchEvent(new Event("change", { bubbles: true }));
}
function selectFormat(id: string): void {
	const radio = panel().querySelector<HTMLInputElement>(`input[type=radio][value="${id}"]`);
	if (!radio) throw new Error(`format "${id}" not found`);
	radio.checked = true;
	radio.dispatchEvent(new Event("change", { bubbles: true }));
}
