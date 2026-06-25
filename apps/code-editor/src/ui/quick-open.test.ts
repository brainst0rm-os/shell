// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { type CodeFileRow, entityToCodeFileRow } from "../logic/code-projection";
import { openQuickOpen } from "./quick-open";

function row(id: string, path: string): CodeFileRow {
	return entityToCodeFileRow({
		id,
		properties: { path, content: "" },
		createdAt: 0,
		updatedAt: 0,
	});
}

afterEach(() => document.body.replaceChildren());

function typeInto(input: HTMLInputElement, value: string): void {
	input.value = value;
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("openQuickOpen", () => {
	function mount(rows: CodeFileRow[], onChoose = vi.fn()) {
		const host = document.createElement("div");
		document.body.appendChild(host);
		const controller = openQuickOpen({ rows, mount: host, onChoose });
		const input = host.querySelector<HTMLInputElement>(".editor__quickopen-input");
		const list = host.querySelector<HTMLElement>(".editor__quickopen-list");
		if (!input || !list) throw new Error("palette did not mount");
		return { host, controller, input, list, onChoose };
	}

	it("KBN-A: results form a combobox listbox driven from the input", () => {
		const { input, list } = mount([row("a", "alpha.ts"), row("b", "beta.ts")]);
		// With an empty query every file ranks, so both rows render.
		const rows = list.querySelectorAll<HTMLElement>(".editor__quickopen-item");
		expect(rows).toHaveLength(2);
		// Roles flow from the binding, not hand-written markup.
		expect(list.getAttribute("role")).toBe("listbox");
		expect(rows[0]?.getAttribute("role")).toBe("option");
		// activedescendant lives on the input; row 0 is active.
		expect(input.getAttribute("aria-activedescendant")).toBe(rows[0]?.id);
		expect(rows[0]?.dataset.active).toBe("true");
	});

	it("ArrowDown on the input moves the active option", () => {
		const { input, list } = mount([row("a", "alpha.ts"), row("b", "beta.ts")]);
		const rows = list.querySelectorAll<HTMLElement>(".editor__quickopen-item");
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
		expect(input.getAttribute("aria-activedescendant")).toBe(rows[1]?.id);
		expect(rows[1]?.dataset.active).toBe("true");
		expect(rows[1]?.getAttribute("aria-selected")).toBe("true");
	});

	it("Enter opens the active file and closes the palette", () => {
		const onChoose = vi.fn();
		const { input, host } = mount([row("a", "alpha.ts"), row("b", "beta.ts")], onChoose);
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		expect(onChoose).toHaveBeenCalledTimes(1);
		expect(onChoose.mock.calls[0]?.[0]).toBe("b");
		expect(host.querySelector(".editor__quickopen-overlay")).toBeNull();
	});

	it("filters live as the user types", () => {
		const { input, list } = mount([row("a", "alpha.ts"), row("b", "beta.ts")]);
		typeInto(input, "beta");
		const rows = list.querySelectorAll<HTMLElement>(".editor__quickopen-item");
		expect(rows).toHaveLength(1);
		expect(rows[0]?.dataset.fileId).toBe("b");
		// activedescendant re-points at the surviving row after the rebuild.
		expect(input.getAttribute("aria-activedescendant")).toBe(rows[0]?.id);
	});

	it("Escape closes and fires onClose", () => {
		const onClose = vi.fn();
		const host = document.createElement("div");
		document.body.appendChild(host);
		openQuickOpen({ rows: [row("a", "alpha.ts")], mount: host, onChoose: vi.fn(), onClose });
		const input = host.querySelector<HTMLInputElement>(".editor__quickopen-input");
		if (!input) throw new Error("no input");
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		expect(host.querySelector(".editor__quickopen-overlay")).toBeNull();
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("clicking a result (mousedown) opens it", () => {
		const onChoose = vi.fn();
		const { list } = mount([row("a", "alpha.ts"), row("b", "beta.ts")], onChoose);
		const rows = list.querySelectorAll<HTMLElement>(".editor__quickopen-item");
		rows[1]?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		expect(onChoose).toHaveBeenCalledTimes(1);
		expect(onChoose.mock.calls[0]?.[0]).toBe("b");
	});
});
