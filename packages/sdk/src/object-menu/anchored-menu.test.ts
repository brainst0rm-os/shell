// @vitest-environment jsdom
/**
 * The generic anchored menu — Database's filter / list / view-tab menus
 * (and the object menu) all render through this. Promoted from the
 * Database private `context-menu.ts`; the parity-critical bits are: one
 * open at a time, disabled rows don't fire, destructive styling, glyph
 * support, mousedown-outside + Escape close.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IconName } from "../icon/icon-registry";
import { closeAnchoredMenu, openAnchoredMenu } from "./anchored-menu";

const opts = { menuLabel: "Database menu" };

function rows(): HTMLButtonElement[] {
	return [...document.querySelectorAll<HTMLButtonElement>(".bs-object-menu__item")];
}

beforeEach(() => {
	vi.stubGlobal("innerWidth", 1024);
	vi.stubGlobal("innerHeight", 768);
});
afterEach(() => {
	closeAnchoredMenu();
	document.body.innerHTML = "";
	vi.unstubAllGlobals();
});

describe("openAnchoredMenu", () => {
	it("labels the region and renders rows", () => {
		openAnchoredMenu({ x: 5, y: 5 }, [{ label: "Rename", onSelect: vi.fn() }], opts);
		expect(document.querySelector(".bs-object-menu")?.getAttribute("aria-label")).toBe(
			"Database menu",
		);
		expect(rows().map((b) => b.textContent)).toEqual(["Rename"]);
	});

	it("disabled rows are disabled and never fire", () => {
		const onSelect = vi.fn();
		openAnchoredMenu(
			{ x: 5, y: 5 },
			[{ label: "Delete", onSelect, disabled: true, destructive: true }],
			opts,
		);
		const btn = rows()[0];
		expect(btn?.disabled).toBe(true);
		expect(btn?.dataset.destructive).toBe("true");
		btn?.click();
		expect(onSelect).not.toHaveBeenCalled();
	});

	it("an icon renders a leading glyph", () => {
		openAnchoredMenu(
			{ x: 5, y: 5 },
			[{ label: "Trash", onSelect: vi.fn(), icon: IconName.Trash }],
			opts,
		);
		expect(rows()[0]?.querySelector(".bs-object-menu__glyph")).not.toBeNull();
	});

	it("a divider renders a non-interactive separator between rows", () => {
		openAnchoredMenu(
			{ x: 5, y: 5 },
			[
				{ label: "Pin", onSelect: vi.fn() },
				{ divider: true },
				{ label: "Delete", onSelect: vi.fn(), destructive: true },
			],
			opts,
		);
		const sep = document.querySelector(".bs-object-menu__divider");
		expect(sep?.getAttribute("role")).toBe("separator");
		// The divider is not an actionable row.
		expect(rows().map((b) => b.textContent)).toEqual(["Pin", "Delete"]);
	});

	it("a shortcut paints a trailing accelerator caption", () => {
		openAnchoredMenu({ x: 5, y: 5 }, [{ label: "Delete", onSelect: vi.fn(), shortcut: "⌘⌫" }], opts);
		expect(rows()[0]?.querySelector(".bs-object-menu__shortcut")?.textContent).toBe("⌘⌫");
	});

	it("selecting closes then runs", () => {
		const onSelect = vi.fn();
		openAnchoredMenu({ x: 5, y: 5 }, [{ label: "Go", onSelect }], opts);
		rows()[0]?.click();
		expect(onSelect).toHaveBeenCalledOnce();
		expect(document.querySelector(".bs-object-menu")).toBeNull();
	});

	it("one menu at a time; explicit close works", () => {
		openAnchoredMenu({ x: 5, y: 5 }, [{ label: "A", onSelect: vi.fn() }], opts);
		openAnchoredMenu({ x: 6, y: 6 }, [{ label: "B", onSelect: vi.fn() }], opts);
		expect(document.querySelectorAll(".bs-object-menu")).toHaveLength(1);
		closeAnchoredMenu();
		expect(document.querySelector(".bs-object-menu")).toBeNull();
		closeAnchoredMenu(); // idempotent
	});

	it("mousedown outside + Escape both close", () => {
		openAnchoredMenu({ x: 5, y: 5 }, [{ label: "A", onSelect: vi.fn() }], opts);
		document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		expect(document.querySelector(".bs-object-menu")).toBeNull();

		openAnchoredMenu({ x: 5, y: 5 }, [{ label: "A", onSelect: vi.fn() }], opts);
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		expect(document.querySelector(".bs-object-menu")).toBeNull();
	});
});
