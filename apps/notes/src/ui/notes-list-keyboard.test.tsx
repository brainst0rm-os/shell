// @vitest-environment jsdom
/**
 * KBN-A-notes (sidebar list) — the note list's composite-keyboard contract:
 * the `<ul>` is a listbox (one Tab stop, `aria-activedescendant`), ArrowDown/Up
 * move the cursor note-to-note (date-section headers are skipped), and moving
 * selects+opens the note. Driven by dispatching keydown on the container; the
 * reducer fires `onSelect` by index, so per-row virtual rendering (perf-CI) is
 * not needed to verify the wiring.
 */

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoredNote } from "../store/note";
import { NotesList } from "./notes-list";

function note(id: string, updatedAt: number): StoredNote {
	return {
		id,
		title: id,
		icon: null,
		cover: null,
		body: "",
		values: {} as StoredNote["values"],
		createdAt: 0,
		updatedAt,
	} as StoredNote;
}

function mount(
	notes: Map<string, StoredNote>,
	selectedId: string | null,
	onSelect: (id: string) => void,
): { root: Root; list: HTMLElement } {
	const el = document.createElement("div");
	document.body.appendChild(el);
	const root = createRoot(el);
	act(() => {
		root.render(
			<NotesList
				notes={notes}
				selectedId={selectedId}
				onSelect={onSelect}
				runtime={null}
				onRemoveNote={vi.fn()}
			/>,
		);
	});
	const list = el.querySelector<HTMLElement>('[role="listbox"]');
	if (!list) throw new Error("listbox not rendered");
	return { root, list };
}

function press(node: HTMLElement, key: string): void {
	act(() => {
		node.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
	});
}

// Two notes stamped "now" land in the same Today bucket: [Header, A, B].
function twoTodayNotes(): Map<string, StoredNote> {
	const now = Date.now();
	return new Map([
		["a", note("a", now)],
		["b", note("b", now - 1000)],
	]);
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("NotesList keyboard (KBN-A-notes sidebar)", () => {
	it("renders the list as a single-tab-stop listbox", () => {
		const { list } = mount(twoTodayNotes(), "a", vi.fn());
		expect(list.getAttribute("role")).toBe("listbox");
		expect(list.getAttribute("tabindex")).toBe("0");
	});

	it("ArrowDown moves selection to the next note, skipping the date header", () => {
		const onSelect = vi.fn();
		// 'a' is newest → index 1 (after the Today header at 0); 'b' is index 2.
		const { list } = mount(twoTodayNotes(), "a", onSelect);
		press(list, "ArrowDown");
		expect(onSelect).toHaveBeenCalledWith("b");
	});

	it("ArrowUp moves selection to the previous note", () => {
		const onSelect = vi.fn();
		const { list } = mount(twoTodayNotes(), "b", onSelect);
		press(list, "ArrowUp");
		expect(onSelect).toHaveBeenCalledWith("a");
	});

	it("Enter activates (selects) the current note", () => {
		const onSelect = vi.fn();
		const { list } = mount(twoTodayNotes(), "a", onSelect);
		press(list, "Enter");
		expect(onSelect).toHaveBeenCalledWith("a");
	});
});
