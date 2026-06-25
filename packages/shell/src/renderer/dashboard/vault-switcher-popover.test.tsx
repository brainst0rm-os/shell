/**
 * Vault-switcher popover (CmdOrCtrl+Shift+V) — unit tests for the pure
 * sort + initial-selection helpers, plus an SSR smoke render proving the
 * popover wires through the design-system primitive and renders each
 * vault row, the "Current" badge on the active vault, and the
 * "Open another vault…" footer action.
 *
 * Interactive keyboard flow (arrow nav, Enter activate, hook-stamped roles)
 * lives in `vault-switcher-keyboard.test.tsx` (jsdom); the `<Popover>` focus
 * trap is covered by `popover.test.tsx`.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { VaultEntry } from "../../preload";
import {
	VaultSwitcherPopover,
	initialSelectionIndex,
	sortVaultsByLastOpened,
} from "./vault-switcher-popover";

function vault(partial: Partial<VaultEntry> & Pick<VaultEntry, "id">): VaultEntry {
	return {
		id: partial.id,
		name: partial.name ?? `Vault ${partial.id}`,
		color: partial.color ?? "#abcdef",
		path: partial.path ?? `/vaults/${partial.id}`,
		lastOpenedAt: partial.lastOpenedAt ?? 0,
		format: partial.format ?? "brainstorm/1",
		...(partial.icon !== undefined ? { icon: partial.icon } : {}),
	};
}

describe("sortVaultsByLastOpened", () => {
	it("orders by lastOpenedAt descending", () => {
		const sorted = sortVaultsByLastOpened([
			vault({ id: "a", lastOpenedAt: 100 }),
			vault({ id: "b", lastOpenedAt: 300 }),
			vault({ id: "c", lastOpenedAt: 200 }),
		]);
		expect(sorted.map((v) => v.id)).toEqual(["b", "c", "a"]);
	});

	it("does not mutate the input array", () => {
		const input = [vault({ id: "a", lastOpenedAt: 1 }), vault({ id: "b", lastOpenedAt: 2 })];
		const inputBefore = input.map((v) => v.id);
		sortVaultsByLastOpened(input);
		expect(input.map((v) => v.id)).toEqual(inputBefore);
	});

	it("returns an empty array for empty input", () => {
		expect(sortVaultsByLastOpened([])).toEqual([]);
	});
});

describe("initialSelectionIndex", () => {
	const sorted = [
		vault({ id: "a", lastOpenedAt: 3 }),
		vault({ id: "b", lastOpenedAt: 2 }),
		vault({ id: "c", lastOpenedAt: 1 }),
	];

	it("returns -1 when the list is empty", () => {
		expect(initialSelectionIndex([], "anything")).toBe(-1);
	});

	it("skips the current vault so Enter switches immediately", () => {
		expect(initialSelectionIndex(sorted, "a")).toBe(1);
		expect(initialSelectionIndex(sorted, "b")).toBe(0);
	});

	it("falls back to index 0 when currentId is null", () => {
		expect(initialSelectionIndex(sorted, null)).toBe(0);
	});

	it("falls back to index 0 when every vault is current (single-vault case)", () => {
		const single = sorted.slice(0, 1);
		expect(initialSelectionIndex(single, "a")).toBe(0);
	});
});

describe("VaultSwitcherPopover — SSR smoke", () => {
	const personal = vault({
		id: "v1",
		name: "Personal",
		path: "/Users/me/Personal",
		lastOpenedAt: 200,
	});
	const work = vault({ id: "v2", name: "Work", path: "/Users/me/Work", lastOpenedAt: 300 });
	const vaults = [personal, work];

	it("renders the Popover chrome + a row per vault", () => {
		const html = renderToStaticMarkup(
			<VaultSwitcherPopover
				current={personal}
				vaults={vaults}
				onActivate={() => undefined}
				onOpenAnother={() => undefined}
				onClose={() => undefined}
			/>,
		);
		expect(html).toContain('class="popover"');
		expect(html).toContain('role="dialog"');
		expect(html).toContain('role="listbox"');
		expect(html).toContain("Personal");
		expect(html).toContain("Work");
		expect(html).toContain("/Users/me/Personal");
		// Footer reuses the existing folder-picker path.
		expect(html).toContain("Open another vault");
	});

	it("renders the Current badge on the active vault and not others", () => {
		const html = renderToStaticMarkup(
			<VaultSwitcherPopover
				current={work}
				vaults={vaults}
				onActivate={() => undefined}
				onOpenAnother={() => undefined}
				onClose={() => undefined}
			/>,
		);
		// One Current badge — on the work row.
		const occurrences = html.match(/vault-switcher__badge/g) ?? [];
		expect(occurrences.length).toBe(1);
	});

	it("renders the empty state when no vaults are registered", () => {
		const html = renderToStaticMarkup(
			<VaultSwitcherPopover
				current={null}
				vaults={[]}
				onActivate={() => undefined}
				onOpenAnother={() => undefined}
				onClose={() => undefined}
			/>,
		);
		expect(html).toContain("No other vaults available.");
		expect(html).not.toContain('role="listbox"');
		// Footer still offers the open-folder path so the empty state is recoverable.
		expect(html).toContain("Open another vault");
	});

	// 12.8 — the registry-corruption "Add back" surface (doc 28 §Recovery).
	const lost = vault({ id: "v3", name: "Lost Vault", path: "/Users/me/Lost" });

	it("renders the recovered section with an Add back action per found vault", () => {
		const html = renderToStaticMarkup(
			<VaultSwitcherPopover
				current={personal}
				vaults={vaults}
				recovered={[lost]}
				onActivate={() => undefined}
				onAddBack={() => undefined}
				onOpenAnother={() => undefined}
				onClose={() => undefined}
			/>,
		);
		expect(html).toContain("Found on disk");
		expect(html).toContain("Lost Vault");
		expect(html).toContain("/Users/me/Lost");
		expect(html).toContain("Add back");
	});

	it("omits the recovered section when none are found or no handler is wired", () => {
		const none = renderToStaticMarkup(
			<VaultSwitcherPopover
				current={personal}
				vaults={vaults}
				recovered={[]}
				onActivate={() => undefined}
				onAddBack={() => undefined}
				onOpenAnother={() => undefined}
				onClose={() => undefined}
			/>,
		);
		expect(none).not.toContain("Found on disk");

		const noHandler = renderToStaticMarkup(
			<VaultSwitcherPopover
				current={personal}
				vaults={vaults}
				recovered={[lost]}
				onActivate={() => undefined}
				onOpenAnother={() => undefined}
				onClose={() => undefined}
			/>,
		);
		expect(noHandler).not.toContain("Found on disk");
	});
});
