// @vitest-environment jsdom
/**
 * BUG 1 — per-folder view-options must NOT stamp every visited folder with
 * the previous folder's options.
 *
 * Regression: the persist effect was gated only on the hydrated-folder ref.
 * The hydrate effect set that ref to the new folder before the option state
 * had caught up, so merely navigating into a folder wrote the OLD folder's
 * `{mode,sort,group,…}` under the NEW folder's key — pinning an explicit
 * override on every untouched folder and growing the blob unboundedly.
 *
 * The fix adds a "user actually changed an option" dirty flag; the persist
 * effect only writes when an option setter flipped it. These tests boot the
 * hook, navigate without touching options, and assert no per-folder override
 * is written — then change an option and assert it IS persisted.
 */

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useFilesStore } from "../src/store/use-files-store";
import { ViewMode } from "../src/view-mode";

type Probe = { store: ReturnType<typeof useFilesStore> | null };

function mount(probe: Probe): { root: Root } {
	const el = document.createElement("div");
	document.body.appendChild(el);
	const root = createRoot(el);
	function Harness() {
		probe.store = useFilesStore();
		return null;
	}
	// No StrictMode here: we exercise the effect-driven persist gate, which
	// the runtime drives once per commit.
	act(() => {
		root.render(<Harness />);
	});
	return { root };
}

/** The stored view-options blob's `folders` map (legacy unscoped key — the
 *  store has no snapshot in this harness, so it falls back to it). */
function storedFolders(): Record<string, unknown> {
	const raw = localStorage.getItem("brainstorm.files.viewOptions.v1");
	if (!raw) return {};
	const parsed = JSON.parse(raw) as { folders?: Record<string, unknown> };
	return parsed.folders ?? {};
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

describe("useFilesStore per-folder view options (BUG 1)", () => {
	it("navigating into a folder does NOT persist an override", () => {
		const { root } = mount(probe);

		// Create a real sub-folder under root, then navigate into it.
		let folderId = "";
		act(() => {
			probe.store?.newFolder();
		});
		const created = probe.store?.tree
			.list()
			.find((e) => e.id !== "brainstorm/root-folder/v1" && e.type === "brainstorm/Folder/v1");
		folderId = created?.id ?? "";
		expect(folderId).not.toBe("");

		act(() => probe.store?.navigateToFolder(folderId));

		// Merely visiting the folder must not write a per-folder override for
		// either the root or the visited folder.
		expect(Object.keys(storedFolders())).toEqual([]);

		act(() => root.unmount());
	});

	it("explicitly changing an option persists an override for THAT folder only", () => {
		const { root } = mount(probe);

		let folderId = "";
		act(() => {
			probe.store?.newFolder();
		});
		const created = probe.store?.tree
			.list()
			.find((e) => e.id !== "brainstorm/root-folder/v1" && e.type === "brainstorm/Folder/v1");
		folderId = created?.id ?? "";

		act(() => probe.store?.navigateToFolder(folderId));
		act(() => probe.store?.setViewMode(ViewMode.Gallery));

		const folders = storedFolders();
		// Only the folder the user changed gets an override — not root.
		expect(Object.keys(folders)).toEqual([folderId]);
		expect((folders[folderId] as { mode?: string }).mode).toBe(ViewMode.Gallery);

		act(() => root.unmount());
	});
});
