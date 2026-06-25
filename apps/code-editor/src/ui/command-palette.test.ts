// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorCommand } from "../logic/command-palette";
import { openCommandPalette } from "./command-palette";

function cmd(
	id: string,
	label: string,
	run = vi.fn(),
	keywords?: readonly string[],
): EditorCommand {
	return { id, label, run, ...(keywords ? { keywords } : {}) };
}

afterEach(() => document.body.replaceChildren());

function typeInto(input: HTMLInputElement, value: string): void {
	input.value = value;
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("openCommandPalette", () => {
	function mount(commands: EditorCommand[]) {
		const host = document.createElement("div");
		document.body.appendChild(host);
		const controller = openCommandPalette({ commands, mount: host });
		const input = host.querySelector<HTMLInputElement>(".editor__quickopen-input");
		const list = host.querySelector<HTMLElement>(".editor__quickopen-list");
		if (!input || !list) throw new Error("palette did not mount");
		return { host, controller, input, list };
	}

	it("KBN-A: results form a combobox listbox driven from the input", () => {
		const { input, list } = mount([cmd("a", "Save file"), cmd("b", "New file")]);
		const rows = list.querySelectorAll<HTMLElement>(".editor__quickopen-item");
		expect(rows).toHaveLength(2);
		expect(list.getAttribute("role")).toBe("listbox");
		expect(rows[0]?.getAttribute("role")).toBe("option");
		expect(input.getAttribute("aria-activedescendant")).toBe(rows[0]?.id);
		expect(rows[0]?.dataset.active).toBe("true");
	});

	it("ArrowDown on the input moves the active option", () => {
		const { input, list } = mount([cmd("a", "Save file"), cmd("b", "New file")]);
		const rows = list.querySelectorAll<HTMLElement>(".editor__quickopen-item");
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
		expect(input.getAttribute("aria-activedescendant")).toBe(rows[1]?.id);
		expect(rows[1]?.dataset.active).toBe("true");
		expect(rows[1]?.getAttribute("aria-selected")).toBe("true");
	});

	it("Enter runs the active command and closes the palette", () => {
		const runA = vi.fn();
		const runB = vi.fn();
		const { input, host } = mount([cmd("a", "Save file", runA), cmd("b", "New file", runB)]);
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		expect(runB).toHaveBeenCalledTimes(1);
		expect(runA).not.toHaveBeenCalled();
		expect(host.querySelector(".editor__quickopen-overlay")).toBeNull();
	});

	it("filters live as the user types (label + keyword)", () => {
		const { input, list } = mount([
			cmd("a", "Save file"),
			cmd("b", "Close tab", vi.fn(), ["remove"]),
		]);
		typeInto(input, "remove");
		const rows = list.querySelectorAll<HTMLElement>(".editor__quickopen-item");
		expect(rows).toHaveLength(1);
		expect(rows[0]?.dataset.commandId).toBe("b");
		expect(input.getAttribute("aria-activedescendant")).toBe(rows[0]?.id);
	});

	it("shows the empty state when nothing matches", () => {
		const { input, list } = mount([cmd("a", "Save file")]);
		typeInto(input, "zzzz");
		expect(list.querySelectorAll(".editor__quickopen-item")).toHaveLength(0);
		expect(list.querySelector(".editor__quickopen-empty")).not.toBeNull();
	});

	it("Escape closes and fires onClose", () => {
		const onClose = vi.fn();
		const host = document.createElement("div");
		document.body.appendChild(host);
		openCommandPalette({ commands: [cmd("a", "Save file")], mount: host, onClose });
		const input = host.querySelector<HTMLInputElement>(".editor__quickopen-input");
		if (!input) throw new Error("no input");
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		expect(host.querySelector(".editor__quickopen-overlay")).toBeNull();
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("clicking a result (mousedown) runs it", () => {
		const run = vi.fn();
		const { list } = mount([cmd("a", "Save file"), cmd("b", "New file", run)]);
		const rows = list.querySelectorAll<HTMLElement>(".editor__quickopen-item");
		rows[1]?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		expect(run).toHaveBeenCalledTimes(1);
	});
});
