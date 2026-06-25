// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Whiteboard } from "../types/whiteboard";
import { renderBoardListView } from "./board-list-view";

function board(id: string, name: string): Whiteboard {
	return {
		id,
		name,
		icon: null,
		nodes: [],
		createdAt: 0,
		updatedAt: 0,
	} as Whiteboard;
}

afterEach(() => document.body.replaceChildren());

function mount(boards: Whiteboard[], activeBoardId: string, onOpen = vi.fn()) {
	const list = document.createElement("div");
	document.body.appendChild(list);
	const handle = renderBoardListView(list, { boards, activeBoardId, onOpen });
	return { list, handle, onOpen };
}

describe("renderBoardListView", () => {
	it("stamps the listbox/option roles from the binding, not by hand", () => {
		const { list } = mount([board("a", "Alpha"), board("b", "Beta")], "a");
		expect(list.getAttribute("role")).toBe("listbox");
		expect(list.getAttribute("aria-orientation")).toBe("vertical");
		const rows = list.querySelectorAll<HTMLElement>(".whiteboard__nav-row");
		expect(rows).toHaveLength(2);
		expect(rows[0]?.getAttribute("role")).toBe("option");
		expect(rows[1]?.getAttribute("role")).toBe("option");
	});

	it("seeds the cursor on the open board and roves with ArrowDown", () => {
		const { list } = mount([board("a", "Alpha"), board("b", "Beta")], "a");
		const rows = list.querySelectorAll<HTMLElement>(".whiteboard__nav-row");
		expect(rows[0]?.getAttribute("aria-selected")).toBe("true");
		expect(rows[0]?.tabIndex).toBe(0);
		expect(rows[1]?.tabIndex).toBe(-1);

		list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
		expect(rows[1]?.getAttribute("aria-selected")).toBe("true");
		expect(rows[1]?.tabIndex).toBe(0);
		expect(rows[0]?.tabIndex).toBe(-1);
	});

	it("Enter on the focused row opens that board", () => {
		const { list, onOpen } = mount([board("a", "Alpha"), board("b", "Beta")], "a");
		list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
		list.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		expect(onOpen).toHaveBeenCalledTimes(1);
		expect(onOpen.mock.calls[0]?.[0]).toBe("b");
	});

	it("clicking a row opens that board", () => {
		const { list, onOpen } = mount([board("a", "Alpha"), board("b", "Beta")], "a");
		list.querySelectorAll<HTMLButtonElement>(".whiteboard__nav-row")[1]?.click();
		expect(onOpen).toHaveBeenCalledTimes(1);
		expect(onOpen.mock.calls[0]?.[0]).toBe("b");
	});

	it("destroy removes the keydown listener", () => {
		const { list, handle, onOpen } = mount([board("a", "Alpha"), board("b", "Beta")], "a");
		handle.destroy();
		list.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		expect(onOpen).not.toHaveBeenCalled();
	});
});
