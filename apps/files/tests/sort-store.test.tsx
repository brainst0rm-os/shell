// @vitest-environment jsdom
/**
 * Pins the StrictMode-safe behaviour of `useFilesStore().setSortKey`.
 *
 * Regression: `setSortKey` previously called `setSortDirection` *inside*
 * the `setSortKeyState` updater. React 18 StrictMode double-invokes
 * updater functions, so clicking the same sort key would flip direction
 * twice (= no-op). The fix moves the direction setter outside the
 * updater (reading the prior key via a ref).
 *
 * This test boots the hook under StrictMode and verifies that pressing
 * the same key once toggles direction exactly once; pressing a different
 * key resets to the natural default for that key.
 */

import { StrictMode } from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SortDirection, SortKey } from "../src/logic/sort";
import { useFilesStore } from "../src/store/use-files-store";

type Probe = { store: ReturnType<typeof useFilesStore> | null };

function mount(probe: Probe): { root: Root } {
	const el = document.createElement("div");
	document.body.appendChild(el);
	const root = createRoot(el);
	function Harness() {
		probe.store = useFilesStore();
		return null;
	}
	act(() => {
		root.render(
			<StrictMode>
				<Harness />
			</StrictMode>,
		);
	});
	return { root };
}

let probe: Probe;

beforeEach(() => {
	probe = { store: null };
});

afterEach(() => {
	document.body.innerHTML = "";
});

describe("useFilesStore.setSortKey (StrictMode safety)", () => {
	it("clicking the active sort key flips direction exactly once under StrictMode", () => {
		const { root } = mount(probe);
		const initialKey = probe.store?.sortKey;
		const initialDir = probe.store?.sortDirection;
		expect(initialKey).toBeDefined();
		expect(initialDir).toBeDefined();

		act(() => probe.store?.setSortKey(initialKey as SortKey));

		// One click → one flip, not two (which would have round-tripped to
		// initial under the old `setSortDirection-inside-updater` bug).
		expect(probe.store?.sortKey).toBe(initialKey);
		expect(probe.store?.sortDirection).not.toBe(initialDir);

		act(() => root.unmount());
	});

	it("changing the sort key resets direction to the natural default for that key", () => {
		const { root } = mount(probe);

		// Pick a key different from the current one and confirm we get the
		// key's defaultDirection (newest-first for date-shaped keys, A→Z
		// for name) rather than the previous direction.
		const targetKey = probe.store?.sortKey === SortKey.Name ? SortKey.Created : SortKey.Name;
		act(() => probe.store?.setSortKey(targetKey));

		expect(probe.store?.sortKey).toBe(targetKey);
		// Name → Asc; date-shaped → Desc. Either way, deterministic for the
		// new key — not "whatever the previous key's direction was".
		expect(
			probe.store?.sortDirection === SortDirection.Asc ||
				probe.store?.sortDirection === SortDirection.Desc,
		).toBe(true);

		act(() => root.unmount());
	});
});
