/**
 * @vitest-environment jsdom
 *
 * `TogglePlugin` — per-device collapse wiring (B11.5). Pins:
 *   1. On mount it reflects the persisted collapsed state (keyed by the
 *      toggle's `data-bs-toggle` id) onto `data-open` — this is the
 *      cross-reload restore path.
 *   2. A click in the disclosure gutter flips the collapsed state, updates
 *      the DOM, and persists it (so a reload restores it).
 *   3. Collapsed state is namespaced per doc — never written to the body.
 */

import { LexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOGGLE_ID_ATTR } from "../nodes/toggle-node";
import { TogglePlugin } from "./toggle-plugin";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let reactRoot: Root;
let editorRoot: HTMLDivElement;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	reactRoot = createRoot(container);
	editorRoot = document.createElement("div");
	document.body.appendChild(editorRoot);
	localStorage.clear();
});

afterEach(() => {
	act(() => reactRoot.unmount());
	container.remove();
	editorRoot.remove();
	localStorage.clear();
});

/** A toggle DOM element as ToggleNode.createDOM would emit it. */
function addToggle(id: string): HTMLElement {
	const el = document.createElement("div");
	el.className = "notes__toggle notes__toggle--paragraph";
	el.setAttribute(TOGGLE_ID_ATTR, id);
	el.dataset.open = "true";
	const summary = document.createElement("p");
	summary.textContent = "Summary";
	el.appendChild(summary);
	editorRoot.appendChild(el);
	return el;
}

function fakeEditor() {
	return {
		getRootElement: vi.fn(() => editorRoot),
		registerRootListener: vi.fn(() => () => {}),
		registerUpdateListener: vi.fn(() => () => {}),
		registerCommand: vi.fn(() => () => {}),
		// Inert: the caret-move on collapse is exercised in the real shell.
		update: vi.fn(),
	};
}

function mount(editor: ReturnType<typeof fakeEditor>, docId: string): void {
	act(() => {
		reactRoot.render(
			<LexicalComposerContext.Provider value={[editor as never, {} as never]}>
				<TogglePlugin docId={docId} />
			</LexicalComposerContext.Provider>,
		);
	});
}

describe("TogglePlugin collapse wiring", () => {
	it("renders nothing", () => {
		addToggle("t1");
		mount(fakeEditor(), "doc-1");
		expect(container.innerHTML).toBe("");
	});

	it("restores the persisted collapsed state onto data-open on mount (reload path)", () => {
		const el = addToggle("t1");
		localStorage.setItem("bs.toggle.doc-1", JSON.stringify(["t1"]));
		mount(fakeEditor(), "doc-1");
		expect(el.dataset.open).toBe("false");
	});

	it("leaves an unseen toggle expanded on mount", () => {
		const el = addToggle("t1");
		mount(fakeEditor(), "doc-1");
		expect(el.dataset.open).toBe("true");
	});

	it("a gutter click collapses, flips data-open, and persists", () => {
		const el = addToggle("t1");
		mount(fakeEditor(), "doc-1");
		act(() => {
			el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 4, clientY: 0 }));
		});
		expect(el.dataset.open).toBe("false");
		expect(JSON.parse(localStorage.getItem("bs.toggle.doc-1") ?? "[]")).toContain("t1");
	});

	it("a second gutter click re-expands and clears the persisted entry", () => {
		const el = addToggle("t1");
		mount(fakeEditor(), "doc-1");
		const click = () =>
			act(() => {
				el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 4, clientY: 0 }));
			});
		click();
		click();
		expect(el.dataset.open).toBe("true");
		expect(localStorage.getItem("bs.toggle.doc-1")).toBeNull();
	});

	it("ignores a click outside the disclosure gutter", () => {
		const el = addToggle("t1");
		// Stub a width so a click far from the left edge is past the gutter.
		el.getBoundingClientRect = () =>
			({ left: 0, top: 0, bottom: 40, right: 400, width: 400, height: 40 }) as DOMRect;
		mount(fakeEditor(), "doc-1");
		act(() => {
			el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 200, clientY: 10 }));
		});
		expect(el.dataset.open).toBe("true");
		expect(localStorage.getItem("bs.toggle.doc-1")).toBeNull();
	});
});
