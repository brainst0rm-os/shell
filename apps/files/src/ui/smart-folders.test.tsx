// @vitest-environment jsdom
/**
 * SmartFolderList (9.8.9): renders the saved searches, activates one on
 * click, and opens a rename / delete menu through the shared anchored-menu
 * runtime (legacy DOM fallback when no menu host is mounted, as in tests).
 */

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchScope } from "../logic/search";
import type { SmartFolder } from "../logic/smart-folders";
import { SmartFolderList } from "./smart-folders";

const FOLDERS: SmartFolder[] = [
	{
		id: "a",
		name: "Designs",
		query: "design",
		scope: SearchScope.Vault,
		folderId: "root",
		createdAt: 1,
	},
	{
		id: "b",
		name: "Invoices",
		query: "invoice",
		scope: SearchScope.ActiveFolder,
		folderId: "f2",
		createdAt: 2,
	},
];

type Harness = {
	host: HTMLElement;
	cleanup: () => void;
	onActivate: ReturnType<typeof vi.fn>;
	onRename: ReturnType<typeof vi.fn>;
	onDelete: ReturnType<typeof vi.fn>;
};

function mount(folders: readonly SmartFolder[] = FOLDERS): Harness {
	const container = document.createElement("div");
	document.body.append(container);
	const root: Root = createRoot(container);
	const onActivate = vi.fn();
	const onRename = vi.fn();
	const onDelete = vi.fn();
	act(() =>
		root.render(
			<SmartFolderList
				folders={folders}
				onActivate={onActivate}
				onRename={onRename}
				onDelete={onDelete}
			/>,
		),
	);
	return {
		host: container,
		onActivate,
		onRename,
		onDelete,
		cleanup: () => {
			act(() => root.unmount());
			container.remove();
		},
	};
}

afterEach(() => {
	// Tear down any legacy anchored-menu popup the ⋯ click left in the body.
	for (const el of document.querySelectorAll(".bs-object-menu")) el.remove();
});

describe("SmartFolderList", () => {
	it("renders nothing when empty", () => {
		const h = mount([]);
		expect(h.host.querySelector('[data-testid="smart-folders"]')).toBeNull();
		h.cleanup();
	});

	it("renders one row per saved search", () => {
		const h = mount();
		const rows = h.host.querySelectorAll('[data-testid="smart-folder-open"]');
		expect(rows).toHaveLength(2);
		expect(rows[0]?.textContent).toContain("Designs");
		expect(rows[1]?.textContent).toContain("Invoices");
		h.cleanup();
	});

	it("activates a folder on click", () => {
		const h = mount();
		const first = h.host.querySelector<HTMLButtonElement>('[data-testid="smart-folder-open"]');
		act(() => first?.click());
		expect(h.onActivate).toHaveBeenCalledWith(FOLDERS[0]);
		h.cleanup();
	});

	it("the ⋯ opens a rename / delete menu that fires the callbacks", () => {
		const h = mount();
		const more = h.host.querySelector<HTMLButtonElement>('[data-testid="smart-folder-more"]');
		act(() => more?.click());
		const menu = document.querySelector<HTMLElement>(".bs-object-menu");
		expect(menu).not.toBeNull();
		const items = menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [];
		expect(items.length).toBe(2);
		// Rename → onRename(folder).
		act(() => items[0]?.click());
		expect(h.onRename).toHaveBeenCalledWith(FOLDERS[0]);

		// Re-open and pick delete → onDelete(id).
		act(() => more?.click());
		const menu2 = document.querySelector<HTMLElement>(".bs-object-menu");
		const items2 = menu2?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [];
		act(() => items2[1]?.click());
		expect(h.onDelete).toHaveBeenCalledWith("a");
		h.cleanup();
	});
});
