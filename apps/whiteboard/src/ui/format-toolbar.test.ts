/**
 * @vitest-environment jsdom
 *
 * Inline formatting toolbar (9.17.12 rest): buttons route to the editor
 * handle, pressed state reflects the selection styles, pressed colour /
 * size buttons clear the override, and pointerdown never steals focus
 * (preventDefault) so the contentEditable selection survives.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createT } from "../i18n/t";
import type { SelectionStyles } from "../logic/rich-text";
import { TextColor, TextSize } from "../types/node";
import { RichMark } from "../types/rich-text";
import { createFormatToolbar } from "./format-toolbar";
import type { InlineTextEditHandle } from "./text-edit";

const t = createT();

function makeEditor(styles?: Partial<SelectionStyles>): InlineTextEditHandle {
	return {
		commit: vi.fn(),
		toggleMark: vi.fn(),
		setColor: vi.fn(),
		setSize: vi.fn(),
		selectionStyles: vi.fn(() => ({
			marks: styles?.marks ?? new Set<RichMark>(),
			color: styles?.color ?? null,
			size: styles?.size ?? null,
		})),
	};
}

function byLabel(bar: HTMLElement, label: string): HTMLButtonElement {
	const btn = bar.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
	if (!btn) throw new Error(`no button labelled ${label}`);
	return btn;
}

describe("createFormatToolbar", () => {
	beforeEach(() => {
		document.body.replaceChildren();
	});

	it("renders a labelled toolbar with mark, colour and size buttons", () => {
		const toolbar = createFormatToolbar({ t, editor: makeEditor() });
		document.body.appendChild(toolbar.element);
		expect(toolbar.element.getAttribute("role")).toBe("toolbar");
		expect(toolbar.element.getAttribute("aria-label")).toBe(t("whiteboard.format.toolbar"));
		// 4 marks + 6 colours + 3 sizes.
		expect(toolbar.element.querySelectorAll("button")).toHaveLength(13);
	});

	it("mark buttons toggle through the editor and reflect pressed state", () => {
		const editor = makeEditor({ marks: new Set([RichMark.Bold]) });
		const toolbar = createFormatToolbar({ t, editor });
		const bold = byLabel(toolbar.element, t("whiteboard.format.bold"));
		expect(bold.getAttribute("aria-pressed")).toBe("true");
		bold.click();
		expect(editor.toggleMark).toHaveBeenCalledWith(RichMark.Bold);
		toolbar.setStyles({ marks: new Set(), color: null, size: null });
		expect(bold.getAttribute("aria-pressed")).toBe("false");
	});

	it("colour buttons set the override; the default dot and pressed dots clear it", () => {
		const editor = makeEditor();
		const toolbar = createFormatToolbar({ t, editor });
		byLabel(toolbar.element, t("whiteboard.style.textColor.red")).click();
		expect(editor.setColor).toHaveBeenCalledWith(TextColor.Red);
		byLabel(toolbar.element, t("whiteboard.style.textColor.default")).click();
		expect(editor.setColor).toHaveBeenLastCalledWith(null);
		toolbar.setStyles({ marks: new Set(), color: TextColor.Red, size: null });
		const red = byLabel(toolbar.element, t("whiteboard.style.textColor.red"));
		expect(red.getAttribute("aria-pressed")).toBe("true");
		red.click();
		expect(editor.setColor).toHaveBeenLastCalledWith(null);
	});

	it("size buttons set the override and clear it when already pressed", () => {
		const editor = makeEditor();
		const toolbar = createFormatToolbar({ t, editor });
		const large = byLabel(toolbar.element, t("whiteboard.style.size.large"));
		large.click();
		expect(editor.setSize).toHaveBeenCalledWith(TextSize.Large);
		toolbar.setStyles({ marks: new Set(), color: null, size: TextSize.Large });
		large.click();
		expect(editor.setSize).toHaveBeenLastCalledWith(null);
	});

	it("prevents default on pointerdown so the editor never blurs", () => {
		const toolbar = createFormatToolbar({ t, editor: makeEditor() });
		document.body.appendChild(toolbar.element);
		const event = new Event("pointerdown", { bubbles: true, cancelable: true });
		toolbar.element.querySelector("button")?.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
	});

	it("destroy removes the element", () => {
		const toolbar = createFormatToolbar({ t, editor: makeEditor() });
		document.body.appendChild(toolbar.element);
		toolbar.destroy();
		expect(document.body.contains(toolbar.element)).toBe(false);
	});
});
