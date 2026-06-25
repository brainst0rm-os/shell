// @vitest-environment jsdom
/**
 * KBN-A-files (inspector tabs) — the Preview / Properties / Links tablist's
 * composite-keyboard contract: the tab strip is a horizontal tablist (`role`
 * from the hook), each tab is a `tab` carrying a roving tabindex + aria-selected,
 * and ArrowRight roves + selects the next tab (selection === showing its panel).
 */

import { type ReactElement, useState } from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { type FilesStore, InspectorTab } from "../store/use-files-store";
import { Inspector } from "./inspector";

/** A controlled host: the Inspector reads `inspectorTab` and writes it via
 *  `setInspectorTab`, so the cursor only moves once the store re-renders. */
function InspectorHarness(): ReactElement {
	const [tab, setTab] = useState<InspectorTab>(InspectorTab.Preview);
	const store = {
		inspectorOpen: true,
		focused: undefined,
		inspectorTab: tab,
		setInspectorTab: setTab,
		toggleInspector: () => {},
	} as unknown as FilesStore;
	return <Inspector store={store} runtime={undefined} />;
}

type Harness = { tablist: HTMLElement; cleanup: () => void };

function mountInspector(): Harness {
	const container = document.createElement("div");
	document.body.append(container);
	const root: Root = createRoot(container);
	act(() => root.render(<InspectorHarness />));
	const tablist = container.querySelector<HTMLElement>('[role="tablist"]');
	if (!tablist) throw new Error("tablist not rendered");
	return {
		tablist,
		cleanup: () => {
			act(() => root.unmount());
			container.remove();
		},
	};
}

function press(node: HTMLElement, key: string): void {
	act(() => {
		node.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
	});
}

describe("Inspector tabs keyboard (KBN-A-files)", () => {
	let h: Harness | null = null;
	afterEach(() => {
		h?.cleanup();
		h = null;
		document.body.innerHTML = "";
	});

	it("renders the tabs as a horizontal tablist (roles from the hook)", () => {
		h = mountInspector();
		expect(h.tablist.getAttribute("role")).toBe("tablist");
		expect(h.tablist.getAttribute("aria-orientation")).toBe("horizontal");
		const tabs = h.tablist.querySelectorAll<HTMLElement>(".inspector__tab");
		// Preview / Properties / Links / Comments (Comments added in the
		// right-panel consistency rollout).
		expect(tabs).toHaveLength(4);
		expect(tabs[0]?.getAttribute("role")).toBe("tab");
		expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
		expect(tabs[0]?.getAttribute("tabindex")).toBe("0");
		expect(tabs[1]?.getAttribute("tabindex")).toBe("-1");
	});

	it("ArrowRight roves to and selects the next tab", () => {
		h = mountInspector();
		press(h.tablist, "ArrowRight");
		const tabs = h.tablist.querySelectorAll<HTMLElement>(".inspector__tab");
		expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");
		expect(tabs[1]?.getAttribute("tabindex")).toBe("0");
		expect(tabs[0]?.getAttribute("aria-selected")).toBe("false");
	});
});
