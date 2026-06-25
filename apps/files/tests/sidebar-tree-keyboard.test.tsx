// @vitest-environment jsdom
/**
 * KBN-A-files — the folder tree's keyboard contract (`useTreeKeyboard`):
 * ArrowDown/Up walk the visible-flat order, ArrowRight/Left expand/collapse,
 * Enter activates. Driven against a minimal fake store so the assertion is on
 * the wiring (which reducer callback fires with which id), not the full app.
 */

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FolderTree } from "../src/logic/folder-tree";
import type { FilesStore } from "../src/store/use-files-store";
import { type Entity, FOLDER_TYPE, ROOT_FOLDER_ID } from "../src/types/entity";
import { SidebarTree } from "../src/ui/sidebar-tree";

function fld(id: string, members: string[] = []): Entity {
	return {
		id,
		type: FOLDER_TYPE,
		properties: { name: id, members },
		createdAt: 0,
		updatedAt: 0,
		deletedAt: null,
	};
}

function seededTree(): FolderTree {
	const tree = new FolderTree();
	tree.applySnapshot([fld(ROOT_FOLDER_ID, ["a", "b"]), fld("a", ["aa"]), fld("aa"), fld("b")]);
	return tree;
}

type Spies = {
	navigateToFolder: ReturnType<typeof vi.fn>;
	toggleFolderExpansion: ReturnType<typeof vi.fn>;
};

function fakeStore(tree: FolderTree, expanded: Set<string>, spies: Spies): FilesStore {
	return {
		tree,
		expandedFolders: expanded,
		nav: { current: ROOT_FOLDER_ID },
		navigateToFolder: spies.navigateToFolder,
		toggleFolderExpansion: spies.toggleFolderExpansion,
	} as unknown as FilesStore;
}

function mount(store: FilesStore): { root: Root; tree: HTMLElement } {
	const el = document.createElement("div");
	document.body.appendChild(el);
	const root = createRoot(el);
	act(() => {
		root.render(<SidebarTree store={store} onCycle={vi.fn()} />);
	});
	const tree = el.querySelector<HTMLElement>('[role="tree"]');
	if (!tree) throw new Error("tree container not rendered");
	return { root, tree };
}

function press(node: HTMLElement, key: string): void {
	act(() => {
		node.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
	});
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("SidebarTree keyboard (KBN-A-files)", () => {
	it("stamps tree + treeitem roles and roving selection", () => {
		const spies = { navigateToFolder: vi.fn(), toggleFolderExpansion: vi.fn() };
		const { tree } = mount(fakeStore(seededTree(), new Set([ROOT_FOLDER_ID]), spies));
		expect(tree.getAttribute("role")).toBe("tree");
		const root = tree.querySelector<HTMLElement>(`[data-tree-node-id="${ROOT_FOLDER_ID}"]`);
		expect(root?.getAttribute("role")).toBe("treeitem");
		expect(root?.getAttribute("aria-selected")).toBe("true");
	});

	it("ArrowDown moves to the first visible child", () => {
		const spies = { navigateToFolder: vi.fn(), toggleFolderExpansion: vi.fn() };
		const { tree } = mount(fakeStore(seededTree(), new Set([ROOT_FOLDER_ID]), spies));
		press(tree, "ArrowDown");
		expect(spies.navigateToFolder).toHaveBeenCalledWith("a");
	});

	it("ArrowRight on a collapsed parent expands it", () => {
		const spies = { navigateToFolder: vi.fn(), toggleFolderExpansion: vi.fn() };
		// Root collapsed → ArrowRight expands (onToggle → toggleFolderExpansion).
		const { tree } = mount(fakeStore(seededTree(), new Set(), spies));
		press(tree, "ArrowRight");
		expect(spies.toggleFolderExpansion).toHaveBeenCalledWith(ROOT_FOLDER_ID);
	});

	it("Enter activates the current node", () => {
		const spies = { navigateToFolder: vi.fn(), toggleFolderExpansion: vi.fn() };
		const { tree } = mount(fakeStore(seededTree(), new Set([ROOT_FOLDER_ID]), spies));
		press(tree, "Enter");
		expect(spies.navigateToFolder).toHaveBeenCalledWith(ROOT_FOLDER_ID);
	});
});
