/**
 * @vitest-environment jsdom
 *
 * Commit-path contract for the inline node-text editor (F-199): the typed
 * text must land in `onCommit` exactly once — via blur, the commit chord,
 * or a forced programmatic commit — and the cancel chord must abandon the
 * edit without committing. The dogfood failure mode was a sticky left
 * textless after "double-click then type"; this pins the editor half of
 * that path as far as jsdom can drive it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectOffsets } from "../render/rich-dom";
import { ActionId, bindShortcut } from "../shortcuts";
import { TextColor, TextSize } from "../types/node";
import { RichMark } from "../types/rich-text";
import { beginInlineTextEdit } from "./text-edit";

// No tabindex here — the production node body has none; `beginInlineTextEdit`
// itself must make the element focusable (jsdom won't focus a contentEditable
// div without it, which is exactly how the suite proves the editor owns the
// keyboard the instant the spawn path returns — F-213).
function mountBody(): HTMLElement {
	const body = document.createElement("div");
	body.className = "whiteboard__node-body whiteboard__node-body--placeholder";
	document.body.appendChild(body);
	return body;
}

describe("beginInlineTextEdit", () => {
	beforeEach(() => {
		document.body.replaceChildren();
	});

	it("turns the body into a focused, labelled textbox seeded with the model text", () => {
		const body = mountBody();
		beginInlineTextEdit(body, {
			text: "hello",
			ariaLabel: "Edit node text",
			onCommit: () => {},
			onCancel: () => {},
		});
		expect(body.getAttribute("contenteditable")).toBe("true");
		expect(body.getAttribute("role")).toBe("textbox");
		expect(body.getAttribute("aria-label")).toBe("Edit node text");
		expect(body.textContent).toBe("hello");
		expect(body.classList.contains("whiteboard__node-body--placeholder")).toBe(false);
		expect(body.classList.contains("whiteboard__node-body--editing")).toBe(true);
		expect(document.activeElement).toBe(body);
	});

	it("commits the typed text on blur", async () => {
		const body = mountBody();
		const onCommit = vi.fn();
		beginInlineTextEdit(body, {
			text: "",
			ariaLabel: "Edit node text",
			onCommit,
			onCancel: () => {},
		});
		body.textContent = "Ship the launch plan";
		body.dispatchEvent(new FocusEvent("blur"));
		// Blur commits via a microtask (so a repaint detaching the editor can
		// finish its DOM mutation first) — flush it before asserting.
		await Promise.resolve();
		expect(onCommit).toHaveBeenCalledTimes(1);
		expect(onCommit).toHaveBeenCalledWith("Ship the launch plan", null);
	});

	it("commits on the commit-edit chord (CmdOrCtrl+Enter) and not again on blur", () => {
		const body = mountBody();
		const onCommit = vi.fn();
		beginInlineTextEdit(body, {
			text: "",
			ariaLabel: "Edit node text",
			onCommit,
			onCancel: () => {},
		});
		body.textContent = "typed";
		body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
		body.dispatchEvent(new FocusEvent("blur"));
		expect(onCommit).toHaveBeenCalledTimes(1);
		expect(onCommit).toHaveBeenCalledWith("typed", null);
	});

	it("cancels on Escape without committing", () => {
		const body = mountBody();
		const onCommit = vi.fn();
		const onCancel = vi.fn();
		beginInlineTextEdit(body, {
			text: "original",
			ariaLabel: "Edit node text",
			onCommit,
			onCancel,
		});
		body.textContent = "discarded";
		body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		body.dispatchEvent(new FocusEvent("blur"));
		expect(onCancel).toHaveBeenCalledTimes(1);
		expect(onCommit).not.toHaveBeenCalled();
	});

	it("strips the editor chrome on commit (no contentEditable/editing-class zombie)", () => {
		const body = mountBody();
		beginInlineTextEdit(body, {
			text: "",
			ariaLabel: "Edit node text",
			onCommit: () => {},
			onCancel: () => {},
		});
		body.textContent = "typed";
		body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
		// `paintNodes` preserves any element whose body still carries the
		// editing class — a committed editor left dressed would survive every
		// repaint as a listener-less, still-editable zombie.
		expect(body.classList.contains("whiteboard__node-body--editing")).toBe(false);
		expect(body.hasAttribute("contenteditable")).toBe(false);
		expect(body.getAttribute("role")).toBeNull();
		expect(body.getAttribute("aria-label")).toBeNull();
		expect(body.hasAttribute("tabindex")).toBe(false);
	});

	it("printable creation-chord keys land in the editor, never a window-level chord (F-213)", () => {
		const body = mountBody();
		const created = vi.fn();
		const offSticky = bindShortcut(ActionId.CreateSticky, created);
		const offText = bindShortcut(ActionId.CreateText, created);
		const offFrame = bindShortcut(ActionId.CreateFrame, created);
		beginInlineTextEdit(body, {
			text: "",
			ariaLabel: "Edit node text",
			onCommit: () => {},
			onCancel: () => {},
		});
		for (const key of ["s", "t", "f"]) {
			body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
		}
		expect(created).not.toHaveBeenCalled();
		offSticky();
		offText();
		offFrame();
	});

	it("strips the editor chrome on cancel too", () => {
		const body = mountBody();
		beginInlineTextEdit(body, {
			text: "original",
			ariaLabel: "Edit node text",
			onCommit: () => {},
			onCancel: () => {},
		});
		body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		expect(body.classList.contains("whiteboard__node-body--editing")).toBe(false);
		expect(body.hasAttribute("contenteditable")).toBe(false);
	});

	it("force-commit handle resolves the edit exactly once", () => {
		const body = mountBody();
		const onCommit = vi.fn();
		const editor = beginInlineTextEdit(body, {
			text: "",
			ariaLabel: "Edit node text",
			onCommit,
			onCancel: () => {},
		});
		body.textContent = "kept";
		editor.commit();
		editor.commit();
		body.dispatchEvent(new FocusEvent("blur"));
		expect(onCommit).toHaveBeenCalledTimes(1);
		expect(onCommit).toHaveBeenCalledWith("kept", null);
	});

	it("seeds from rich runs and commits the styled model (9.17.12 rest)", () => {
		const body = mountBody();
		const onCommit = vi.fn();
		const editor = beginInlineTextEdit(body, {
			text: "Hello world",
			rich: [{ text: "Hello " }, { text: "world", bold: true }],
			ariaLabel: "Edit node text",
			onCommit,
			onCancel: () => {},
		});
		expect(body.textContent).toBe("Hello world");
		expect(body.querySelector("span[data-bold='1']")?.textContent).toBe("world");
		editor.commit();
		expect(onCommit).toHaveBeenCalledWith("Hello world", [
			{ text: "Hello " },
			{ text: "world", bold: true },
		]);
	});

	it("toggleMark formats the DOM selection and reports it via onFormatState", () => {
		const body = mountBody();
		const onCommit = vi.fn();
		const onFormatState = vi.fn();
		const editor = beginInlineTextEdit(body, {
			text: "Hello world",
			ariaLabel: "Edit node text",
			onCommit,
			onCancel: () => {},
			onFormatState,
		});
		// Select "world" (offsets 6..11) then bold it.
		selectOffsets(body, 6, 11);
		editor.toggleMark(RichMark.Bold);
		expect(editor.selectionStyles().marks.has(RichMark.Bold)).toBe(true);
		expect(onFormatState).toHaveBeenCalled();
		editor.commit();
		expect(onCommit).toHaveBeenCalledWith("Hello world", [
			{ text: "Hello " },
			{ text: "world", bold: true },
		]);
	});

	it("a collapsed selection formats the whole body; colour/size apply too", () => {
		const body = mountBody();
		const onCommit = vi.fn();
		const editor = beginInlineTextEdit(body, {
			text: "abc",
			ariaLabel: "Edit node text",
			onCommit,
			onCancel: () => {},
		});
		// Collapse the caret to one point — formatting still hits everything.
		selectOffsets(body, 1, 1);
		editor.toggleMark(RichMark.Strike);
		editor.setColor(TextColor.Red);
		editor.setSize(TextSize.Large);
		editor.commit();
		expect(onCommit).toHaveBeenCalledWith("abc", [
			{ text: "abc", strike: true, color: TextColor.Red, size: TextSize.Large },
		]);
	});

	it("the format chords (Cmd/Ctrl+B/I/U, Cmd/Ctrl+Shift+X) toggle marks while editing", () => {
		const body = mountBody();
		const onCommit = vi.fn();
		beginInlineTextEdit(body, {
			text: "abc",
			ariaLabel: "Edit node text",
			onCommit,
			onCancel: () => {},
		});
		selectOffsets(body, 0, 3);
		body.dispatchEvent(new KeyboardEvent("keydown", { key: "u", ctrlKey: true, bubbles: true }));
		body.dispatchEvent(
			new KeyboardEvent("keydown", { key: "X", ctrlKey: true, shiftKey: true, bubbles: true }),
		);
		body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
		expect(onCommit).toHaveBeenCalledWith("abc", [{ text: "abc", underline: true, strike: true }]);
	});
});
