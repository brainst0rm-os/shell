// @vitest-environment jsdom
/**
 * The trigger helper must wire BOTH affordances the cross-app contract
 * mandates: right-click (`contextmenu`) AND a visible, keyboard-reachable
 * ⋯ button. A `null` context is inert; `dispose()` detaches everything.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ObjectMenuRuntime } from "./object-menu";
import { attachObjectMenuTrigger } from "./object-menu-trigger";
import { closeObjectMenu } from "./open-object-menu";

const runtime = (): ObjectMenuRuntime => ({
	capabilities: ["intents.dispatch:open"],
	services: { intents: { dispatch: vi.fn() } },
});

function menuOpen(): boolean {
	return document.querySelector(".bs-object-menu") !== null;
}

beforeEach(() => {
	vi.stubGlobal("innerWidth", 1024);
	vi.stubGlobal("innerHeight", 768);
});

afterEach(() => {
	closeObjectMenu();
	document.body.innerHTML = "";
	vi.unstubAllGlobals();
});

describe("attachObjectMenuTrigger", () => {
	it("returns an accessible ⋯ button", () => {
		const row = document.createElement("div");
		const h = attachObjectMenuTrigger(
			row,
			() => ({ target: { entityId: "e1" }, runtime: runtime() }),
			{ moreActionsLabel: "More actions" },
		);
		expect(h.moreButton.tagName).toBe("BUTTON");
		expect(h.moreButton.getAttribute("aria-haspopup")).toBe("menu");
		expect(h.moreButton.getAttribute("aria-label")).toBe("More actions");
		expect(h.moreButton.querySelectorAll(".bs-object-menu__more-dot")).toHaveLength(3);
		h.dispose();
	});

	it("right-click opens the menu at the cursor", async () => {
		const row = document.createElement("div");
		document.body.appendChild(row);
		const h = attachObjectMenuTrigger(
			row,
			() => ({ target: { entityId: "e1" }, runtime: runtime() }),
			{ moreActionsLabel: "More" },
		);
		row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 30, clientY: 30 }));
		await vi.waitFor(() => expect(menuOpen()).toBe(true));
		h.dispose();
	});

	it("⋯ click opens the menu; Enter on the button also opens it", async () => {
		const row = document.createElement("div");
		document.body.appendChild(row);
		const h = attachObjectMenuTrigger(
			row,
			() => ({ target: { entityId: "e1" }, runtime: runtime() }),
			{ moreActionsLabel: "More" },
		);
		document.body.appendChild(h.moreButton);

		h.moreButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await vi.waitFor(() => expect(menuOpen()).toBe(true));
		closeObjectMenu();

		h.moreButton.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		await vi.waitFor(() => expect(menuOpen()).toBe(true));
		h.dispose();
	});

	it("a null context is inert (no menu, no throw)", async () => {
		const row = document.createElement("div");
		document.body.appendChild(row);
		const h = attachObjectMenuTrigger(row, () => null, { moreActionsLabel: "More" });
		row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
		h.moreButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await new Promise((r) => setTimeout(r, 0));
		expect(menuOpen()).toBe(false);
		h.dispose();
	});

	it("dispose detaches the right-click listener + drops the ⋯ button", () => {
		const row = document.createElement("div");
		document.body.appendChild(row);
		const h = attachObjectMenuTrigger(
			row,
			() => ({ target: { entityId: "e1" }, runtime: runtime() }),
			{ moreActionsLabel: "More" },
		);
		document.body.appendChild(h.moreButton);
		h.dispose();
		row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
		expect(menuOpen()).toBe(false);
		expect(h.moreButton.isConnected).toBe(false);
		h.dispose(); // idempotent
	});
});
