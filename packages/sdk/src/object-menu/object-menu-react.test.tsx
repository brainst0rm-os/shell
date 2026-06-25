// @vitest-environment jsdom
/**
 * `<ObjectMenuTrigger>` — the React twin must wire the same two affordances
 * (right-click + visible ⋯ button) and open the SAME shared popup as the
 * imperative helper, so React apps (Notes) get identical behaviour.
 */

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ObjectMenuRuntime } from "./object-menu";
import { ObjectMenuMoreButton, ObjectMenuTrigger } from "./object-menu-react";
import { closeObjectMenu } from "./open-object-menu";

const runtime = (): ObjectMenuRuntime => ({
	capabilities: ["intents.dispatch:open"],
	services: { intents: { dispatch: vi.fn() } },
});

let host: HTMLElement;
let root: Root;

beforeEach(() => {
	vi.stubGlobal("innerWidth", 1024);
	vi.stubGlobal("innerHeight", 768);
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	closeObjectMenu();
	document.body.innerHTML = "";
	vi.unstubAllGlobals();
});

function menuOpen(): boolean {
	return document.querySelector(".bs-object-menu") !== null;
}

describe("<ObjectMenuTrigger>", () => {
	it("renders children + an accessible ⋯ button", () => {
		act(() => {
			root.render(
				<ObjectMenuTrigger
					context={() => ({ target: { entityId: "e1" }, runtime: runtime() })}
					moreActionsLabel="More actions"
				>
					<span data-testid="child">Row</span>
				</ObjectMenuTrigger>,
			);
		});
		expect(host.querySelector('[data-testid="child"]')).not.toBeNull();
		const btn = host.querySelector<HTMLButtonElement>(".bs-object-menu__more");
		expect(btn?.getAttribute("aria-label")).toBe("More actions");
		expect(btn?.getAttribute("aria-haspopup")).toBe("menu");
	});

	it("right-click and ⋯ click both open the shared popup", async () => {
		act(() => {
			root.render(
				<ObjectMenuTrigger
					context={() => ({ target: { entityId: "e1" }, runtime: runtime() })}
					moreActionsLabel="More"
				>
					<span>Row</span>
				</ObjectMenuTrigger>,
			);
		});
		const wrapper = host.querySelector<HTMLElement>(".bs-object-menu__host");
		act(() => {
			wrapper?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
		});
		await vi.waitFor(() => expect(menuOpen()).toBe(true));
		closeObjectMenu();

		const btn = host.querySelector<HTMLButtonElement>(".bs-object-menu__more");
		act(() => {
			btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await vi.waitFor(() => expect(menuOpen()).toBe(true));
	});

	it("variant='row' adds the host-row modifier class", () => {
		act(() => {
			root.render(
				<ObjectMenuTrigger
					context={() => ({ target: { entityId: "e1" }, runtime: runtime() })}
					moreActionsLabel="More"
					variant="row"
				>
					<span>Row</span>
				</ObjectMenuTrigger>,
			);
		});
		const wrapper = host.querySelector<HTMLElement>(".bs-object-menu__host");
		expect(wrapper?.classList.contains("bs-object-menu__host--row")).toBe(true);
	});

	it("default variant omits the host-row modifier class", () => {
		act(() => {
			root.render(
				<ObjectMenuTrigger
					context={() => ({ target: { entityId: "e1" }, runtime: runtime() })}
					moreActionsLabel="More"
				>
					<span>Row</span>
				</ObjectMenuTrigger>,
			);
		});
		const wrapper = host.querySelector<HTMLElement>(".bs-object-menu__host");
		expect(wrapper?.classList.contains("bs-object-menu__host--row")).toBe(false);
	});

	it("a null context is inert", async () => {
		act(() => {
			root.render(
				<ObjectMenuTrigger context={() => null} moreActionsLabel="More">
					<span>Row</span>
				</ObjectMenuTrigger>,
			);
		});
		const btn = host.querySelector<HTMLButtonElement>(".bs-object-menu__more");
		act(() => {
			btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await new Promise((r) => setTimeout(r, 0));
		expect(menuOpen()).toBe(false);
	});

	it("noMoreButton suppresses the ⋯ but right-click still opens", async () => {
		act(() => {
			root.render(
				<ObjectMenuTrigger
					context={() => ({ target: { entityId: "e1" }, runtime: runtime() })}
					moreActionsLabel="More"
					noMoreButton
				>
					<span>Row</span>
				</ObjectMenuTrigger>,
			);
		});
		expect(host.querySelector(".bs-object-menu__more")).toBeNull();
		const wrapper = host.querySelector<HTMLElement>(".bs-object-menu__host");
		act(() => {
			wrapper?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
		});
		await vi.waitFor(() => expect(menuOpen()).toBe(true));
	});
});

describe("<ObjectMenuMoreButton>", () => {
	it("renders an accessible ⋯ button and opens the shared popup on click", async () => {
		act(() => {
			root.render(
				<ObjectMenuMoreButton
					context={() => ({ target: { entityId: "e1" }, runtime: runtime() })}
					moreActionsLabel="More actions"
				/>,
			);
		});
		const btn = host.querySelector<HTMLButtonElement>(".bs-object-menu__more");
		expect(btn?.getAttribute("aria-label")).toBe("More actions");
		expect(btn?.getAttribute("aria-haspopup")).toBe("menu");
		act(() => {
			btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await vi.waitFor(() => expect(menuOpen()).toBe(true));
	});

	it("a null context is inert", async () => {
		act(() => {
			root.render(<ObjectMenuMoreButton context={() => null} moreActionsLabel="More" />);
		});
		const btn = host.querySelector<HTMLButtonElement>(".bs-object-menu__more");
		act(() => {
			btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await new Promise((r) => setTimeout(r, 0));
		expect(menuOpen()).toBe(false);
	});

	it("disabled is aria-disabled (NOT natively disabled, so it stays hoverable for the tooltip), shows the reason, and never opens", async () => {
		act(() => {
			root.render(
				<ObjectMenuMoreButton
					context={() => ({ target: { entityId: "e1" }, runtime: runtime() })}
					moreActionsLabel="More"
					disabled
					disabledReason="Open an item to see its actions"
				/>,
			);
		});
		const btn = host.querySelector<HTMLButtonElement>(".bs-object-menu__more");
		// F-271: NOT natively disabled — a disabled button emits no hover/focus
		// events, so its tooltip never showed. aria-disabled conveys the state
		// while keeping it hoverable/focusable.
		expect(btn?.disabled).toBe(false);
		expect(btn?.getAttribute("aria-disabled")).toBe("true");
		// The tooltip explains *why* it's dimmed.
		expect(btn?.getAttribute("data-bs-tooltip")).toBe("Open an item to see its actions");
		act(() => {
			btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await new Promise((r) => setTimeout(r, 0));
		expect(menuOpen()).toBe(false);
	});

	it("disabled tooltip falls back to the action label when no reason is given", () => {
		act(() => {
			root.render(
				<ObjectMenuMoreButton
					context={() => ({ target: { entityId: "e1" }, runtime: runtime() })}
					moreActionsLabel="More"
					disabled
				/>,
			);
		});
		const btn = host.querySelector<HTMLButtonElement>(".bs-object-menu__more");
		expect(btn?.getAttribute("data-bs-tooltip")).toBe("More");
	});
});
