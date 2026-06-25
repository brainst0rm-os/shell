/**
 * @vitest-environment jsdom
 *
 * `InitialFocusPlugin` — fix for the new-note "cursor lands on icon"
 * bug. Pins three properties:
 *   1. The plugin renders nothing (it's purely effectful).
 *   2. On mount, it calls `editor.focus(callback, { defaultSelection })`
 *      via `requestAnimationFrame` (deferred past parent render).
 *   3. The focus callback writes a selection at the end of the first
 *      root child (the TitleNode), so the cursor blinks inside the
 *      title (after any existing text) rather than at the document root.
 */

import { LexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InitialFocusPlugin } from "./initial-focus-plugin";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let reactRoot: Root;
let originalRaf: typeof requestAnimationFrame;
let originalCaf: typeof cancelAnimationFrame;
let scheduledCallbacks: Array<() => void>;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	reactRoot = createRoot(container);
	scheduledCallbacks = [];
	originalRaf = globalThis.requestAnimationFrame;
	originalCaf = globalThis.cancelAnimationFrame;
	// Deterministic rAF — tests trigger by flushing manually.
	globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
		scheduledCallbacks.push(() => cb(performance.now()));
		return scheduledCallbacks.length;
	}) as typeof requestAnimationFrame;
	globalThis.cancelAnimationFrame = (() => undefined) as typeof cancelAnimationFrame;
});

afterEach(() => {
	act(() => reactRoot.unmount());
	container.remove();
	globalThis.requestAnimationFrame = originalRaf;
	globalThis.cancelAnimationFrame = originalCaf;
});

function flushRaf(): void {
	const pending = scheduledCallbacks.slice();
	scheduledCallbacks.length = 0;
	for (const cb of pending) cb();
}

function fakeEditor(overrides: Partial<MockEditor> = {}): MockEditor {
	return {
		focus: vi.fn(),
		update: vi.fn(),
		...overrides,
	};
}

interface MockEditor {
	focus: ReturnType<typeof vi.fn>;
	update: ReturnType<typeof vi.fn>;
}

function mount(editor: MockEditor): void {
	act(() => {
		reactRoot.render(
			<LexicalComposerContext.Provider value={[editor as never, {} as never]}>
				<InitialFocusPlugin />
			</LexicalComposerContext.Provider>,
		);
	});
}

describe("InitialFocusPlugin", () => {
	it("renders nothing", () => {
		const editor = fakeEditor();
		mount(editor);
		expect(container.innerHTML).toBe("");
	});

	it("calls editor.focus on the next animation frame, not synchronously", () => {
		const editor = fakeEditor();
		mount(editor);
		// Before rAF flush — focus not yet called.
		expect(editor.focus).not.toHaveBeenCalled();
		flushRaf();
		expect(editor.focus).toHaveBeenCalledTimes(1);
	});

	it("passes `defaultSelection: 'rootStart'` to editor.focus", () => {
		const editor = fakeEditor();
		mount(editor);
		flushRaf();
		const call = editor.focus.mock.calls[0];
		expect(call?.[1]).toEqual({ defaultSelection: "rootStart" });
	});

	it("the focus callback schedules an editor.update with tag 'history-merge'", () => {
		const editor = fakeEditor();
		mount(editor);
		flushRaf();
		// First arg of editor.focus(...) is the post-focus callback.
		const focusCb = editor.focus.mock.calls[0]?.[0] as () => void;
		expect(typeof focusCb).toBe("function");
		focusCb();
		expect(editor.update).toHaveBeenCalledTimes(1);
		const updateOptions = editor.update.mock.calls[0]?.[1];
		expect(updateOptions).toEqual({ tag: "history-merge" });
	});

	it("does not re-fire on unrelated re-renders (the [editor] dep guards it)", () => {
		const editor = fakeEditor();
		mount(editor);
		flushRaf();
		expect(editor.focus).toHaveBeenCalledTimes(1);
		// Re-render with the same editor reference.
		act(() => {
			reactRoot.render(
				<LexicalComposerContext.Provider value={[editor as never, {} as never]}>
					<InitialFocusPlugin />
				</LexicalComposerContext.Provider>,
			);
		});
		flushRaf();
		expect(editor.focus).toHaveBeenCalledTimes(1);
	});
});
