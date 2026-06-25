// @vitest-environment jsdom
/**
 * Smart folders (saved searches, 9.8.9) at the store level: a search saved
 * via `saveSearchAsSmartFolder` lands in `store.smartFolders` AND persists to
 * the per-vault localStorage blob; activating one re-applies its query +
 * scope; deleting removes it.
 */

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SearchScope } from "../logic/search";
import { useFilesStore } from "./use-files-store";

type Probe = { store: ReturnType<typeof useFilesStore> | null };

function mount(probe: Probe): { root: Root } {
	const el = document.createElement("div");
	document.body.appendChild(el);
	const root = createRoot(el);
	function Harness() {
		probe.store = useFilesStore();
		return null;
	}
	act(() => root.render(<Harness />));
	return { root };
}

function storedCount(): number {
	const raw = localStorage.getItem("brainstorm.files.smartFolders.v1");
	if (!raw) return 0;
	const parsed = JSON.parse(raw);
	return Array.isArray(parsed) ? parsed.length : 0;
}

let probe: Probe;

beforeEach(() => {
	localStorage.clear();
	probe = { store: null };
});

afterEach(() => {
	document.body.innerHTML = "";
	localStorage.clear();
});

describe("useFilesStore smart folders (9.8.9)", () => {
	it("saves the active search and exposes + persists it", () => {
		const { root } = mount(probe);
		act(() => {
			probe.store?.setSearchQuery("design");
			probe.store?.setSearchScope(SearchScope.Vault);
		});
		act(() => probe.store?.saveSearchAsSmartFolder("Designs"));

		expect(probe.store?.smartFolders).toHaveLength(1);
		const saved = probe.store?.smartFolders[0];
		expect(saved).toMatchObject({ name: "Designs", query: "design", scope: SearchScope.Vault });
		expect(storedCount()).toBe(1);
		act(() => root.unmount());
	});

	it("does not save a blank query", () => {
		const { root } = mount(probe);
		act(() => probe.store?.setSearchQuery("   "));
		act(() => probe.store?.saveSearchAsSmartFolder("Nothing"));
		expect(probe.store?.smartFolders).toHaveLength(0);
		expect(storedCount()).toBe(0);
		act(() => root.unmount());
	});

	it("activating a saved search re-applies its query + scope", () => {
		const { root } = mount(probe);
		act(() => {
			probe.store?.setSearchQuery("invoice");
			probe.store?.setSearchScope(SearchScope.Subfolders);
		});
		act(() => probe.store?.saveSearchAsSmartFolder("Invoices"));
		const folder = probe.store?.smartFolders[0];
		if (!folder) throw new Error("expected a saved folder");

		// Clear the live search, then activate the saved one.
		act(() => {
			probe.store?.setSearchQuery("");
			probe.store?.setSearchScope(SearchScope.ActiveFolder);
		});
		act(() => probe.store?.activateSmartFolder(folder));

		expect(probe.store?.searchQuery).toBe("invoice");
		expect(probe.store?.searchScope).toBe(SearchScope.Subfolders);
		act(() => root.unmount());
	});

	it("renames and deletes a saved search", () => {
		const { root } = mount(probe);
		act(() => probe.store?.setSearchQuery("brand"));
		act(() => probe.store?.saveSearchAsSmartFolder("Brand"));
		const id = probe.store?.smartFolders[0]?.id;
		if (!id) throw new Error("expected an id");

		act(() => probe.store?.renameSmartFolderById(id, "Brand assets"));
		expect(probe.store?.smartFolders[0]?.name).toBe("Brand assets");

		act(() => probe.store?.deleteSmartFolderById(id));
		expect(probe.store?.smartFolders).toHaveLength(0);
		expect(storedCount()).toBe(0);
		act(() => root.unmount());
	});
});
