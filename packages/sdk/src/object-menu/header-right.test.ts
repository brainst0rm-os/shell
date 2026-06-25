// @vitest-environment jsdom
/**
 * `paintHeaderRight` — the canonical header-right composer: actions and
 * panel toggles first (nulls skipped), the object ⋯ ALWAYS last. Pairs
 * with `createMoreButton(label, { disabled })` for surfaces with no object.
 */

import { describe, expect, it } from "vitest";
import { createMoreButton } from "./delegated";
import { paintHeaderRight } from "./header-right";

function container(): HTMLElement {
	const el = document.createElement("div");
	el.className = "app-header__right";
	return el;
}

function btn(label: string): HTMLButtonElement {
	const b = document.createElement("button");
	b.textContent = label;
	return b;
}

describe("paintHeaderRight", () => {
	it("keeps the given order and places the ⋯ last", () => {
		const right = container();
		const add = btn("add");
		const toggle = btn("toggle");
		const more = createMoreButton("More actions");
		paintHeaderRight(right, [add, toggle], more);
		expect([...right.children]).toEqual([add, toggle, more]);
		expect(right.lastElementChild?.classList.contains("bs-object-menu__more")).toBe(true);
	});

	it("skips null/undefined children but still ends with the ⋯", () => {
		const right = container();
		const toggle = btn("toggle");
		const more = createMoreButton("More actions");
		paintHeaderRight(right, [null, toggle, undefined], more);
		expect([...right.children]).toEqual([toggle, more]);
	});

	it("repaints idempotently (replaceChildren, no accumulation)", () => {
		const right = container();
		const more = createMoreButton("More actions");
		paintHeaderRight(right, [btn("a")], more);
		paintHeaderRight(right, [btn("b")], more);
		expect(right.childElementCount).toBe(2);
		expect(right.lastElementChild).toBe(more);
	});
});

describe("createMoreButton disabled option", () => {
	it("renders aria-disabled (NOT native disabled, so it stays hoverable for the tooltip — F-271)", () => {
		const more = createMoreButton("More actions", {
			disabled: true,
			disabledReason: "Open an item to see its actions",
		});
		expect(more.disabled).toBe(false);
		expect(more.getAttribute("aria-disabled")).toBe("true");
		expect(more.getAttribute("aria-haspopup")).toBe("menu");
		// The tooltip explains why it's dimmed.
		expect(more.dataset.bsTooltip).toBe("Open an item to see its actions");
	});

	it("disabled tooltip falls back to the label when no reason is given", () => {
		const more = createMoreButton("More actions", { disabled: true });
		expect(more.dataset.bsTooltip).toBe("More actions");
	});

	it("defaults to enabled with no aria-disabled", () => {
		const more = createMoreButton("More actions");
		expect(more.disabled).toBe(false);
		expect(more.hasAttribute("aria-disabled")).toBe(false);
	});
});
