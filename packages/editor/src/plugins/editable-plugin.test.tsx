/**
 * @vitest-environment jsdom
 *
 * `EditablePlugin` — runtime page-level lock (B11.11). Pins:
 *   1. Renders nothing (purely effectful).
 *   2. Pushes the `editable` prop onto the live editor only when it
 *      actually differs from the editor's current state (no redundant
 *      setEditable churn).
 *   3. Locking (editable=false) blurs the contenteditable so the caret
 *      can't linger in a now-read-only doc.
 */

import { LexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditablePlugin } from "./editable-plugin";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let reactRoot: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	reactRoot = createRoot(container);
});

afterEach(() => {
	act(() => reactRoot.unmount());
	container.remove();
});

interface MockEditor {
	isEditable: ReturnType<typeof vi.fn>;
	setEditable: ReturnType<typeof vi.fn>;
	getRootElement: ReturnType<typeof vi.fn>;
}

function fakeEditor(
	editableNow: boolean,
	root: { blur: ReturnType<typeof vi.fn> } | null,
): MockEditor {
	return {
		isEditable: vi.fn(() => editableNow),
		setEditable: vi.fn(),
		getRootElement: vi.fn(() => root),
	};
}

function mount(editor: MockEditor, editable: boolean): void {
	act(() => {
		reactRoot.render(
			<LexicalComposerContext.Provider value={[editor as never, {} as never]}>
				<EditablePlugin editable={editable} />
			</LexicalComposerContext.Provider>,
		);
	});
}

describe("EditablePlugin", () => {
	it("renders nothing", () => {
		const editor = fakeEditor(true, null);
		mount(editor, true);
		expect(container.innerHTML).toBe("");
	});

	it("does not call setEditable when the editor already matches the prop", () => {
		const editor = fakeEditor(true, null);
		mount(editor, true);
		expect(editor.setEditable).not.toHaveBeenCalled();
	});

	it("locks the editor (setEditable(false)) and blurs the root", () => {
		const root = { blur: vi.fn() };
		const editor = fakeEditor(true, root);
		mount(editor, false);
		expect(editor.setEditable).toHaveBeenCalledWith(false);
		expect(root.blur).toHaveBeenCalledTimes(1);
	});

	it("unlocks the editor (setEditable(true)) without blurring", () => {
		const root = { blur: vi.fn() };
		const editor = fakeEditor(false, root);
		mount(editor, true);
		expect(editor.setEditable).toHaveBeenCalledWith(true);
		expect(root.blur).not.toHaveBeenCalled();
	});

	it("tolerates a not-yet-mounted root element when locking", () => {
		const editor = fakeEditor(true, null);
		expect(() => mount(editor, false)).not.toThrow();
		expect(editor.setEditable).toHaveBeenCalledWith(false);
	});
});
