/**
 * @vitest-environment jsdom
 *
 * `CommentHighlightPlugin` (B11.9) — highlight stamping + click-to-thread chip.
 * Pins:
 *   1. Commented blocks get `data-bs-comment` carrying their session block id;
 *      stale attributes are cleared when the id set changes.
 *   2. With `onBlockClick`, hovering a commented block reveals the chip and
 *      clicking it hands back the block id.
 *   3. Without `onBlockClick` no chip renders (highlight-only mode).
 *   4. The chip drops when its block stops being commented (thread resolved).
 */

import { LexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMENT_BLOCK_ATTR, CommentHighlightPlugin } from "./comment-highlight-plugin";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let reactRoot: Root;
let editorRoot: HTMLDivElement;
let blocks: Map<string, HTMLElement>;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	reactRoot = createRoot(container);
	editorRoot = document.createElement("div");
	document.body.appendChild(editorRoot);
	blocks = new Map();
});

afterEach(() => {
	act(() => reactRoot.unmount());
	container.remove();
	editorRoot.remove();
});

function addBlock(key: string): HTMLElement {
	const el = document.createElement("p");
	el.textContent = `block ${key}`;
	editorRoot.appendChild(el);
	blocks.set(key, el);
	return el;
}

function fakeEditor() {
	return {
		getRootElement: vi.fn(() => editorRoot),
		getElementByKey: vi.fn((key: string) => blocks.get(key) ?? null),
		registerUpdateListener: vi.fn(() => () => {}),
	};
}

function mount(
	editor: ReturnType<typeof fakeEditor>,
	blockIds: readonly string[],
	onBlockClick?: (blockId: string) => void,
): void {
	act(() => {
		reactRoot.render(
			<LexicalComposerContext.Provider value={[editor as never, {} as never]}>
				<CommentHighlightPlugin blockIds={blockIds} {...(onBlockClick ? { onBlockClick } : {})} />
			</LexicalComposerContext.Provider>,
		);
	});
}

function hover(el: HTMLElement): void {
	act(() => {
		el.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
	});
}

describe("CommentHighlightPlugin", () => {
	it("stamps commented blocks with their block id and clears stale marks", () => {
		const a = addBlock("k1");
		const b = addBlock("k2");
		const editor = fakeEditor();
		mount(editor, ["k1"]);
		expect(a.getAttribute(COMMENT_BLOCK_ATTR)).toBe("k1");
		expect(b.hasAttribute(COMMENT_BLOCK_ATTR)).toBe(false);
		mount(editor, ["k2"]);
		expect(a.hasAttribute(COMMENT_BLOCK_ATTR)).toBe(false);
		expect(b.getAttribute(COMMENT_BLOCK_ATTR)).toBe("k2");
	});

	it("reveals the chip on hover and hands the block id to onBlockClick", () => {
		const a = addBlock("k1");
		const onBlockClick = vi.fn();
		mount(fakeEditor(), ["k1"], onBlockClick);
		expect(container.querySelector(".bs-comment-chip")).toBeNull();
		hover(a);
		const chip = container.querySelector<HTMLButtonElement>(".bs-comment-chip");
		expect(chip).not.toBeNull();
		act(() => chip?.click());
		expect(onBlockClick).toHaveBeenCalledWith("k1");
	});

	it("renders no chip in highlight-only mode (no onBlockClick)", () => {
		const a = addBlock("k1");
		mount(fakeEditor(), ["k1"]);
		hover(a);
		expect(container.querySelector(".bs-comment-chip")).toBeNull();
	});

	it("hides the chip when a non-commented block is hovered", () => {
		const a = addBlock("k1");
		const plain = addBlock("k2");
		mount(fakeEditor(), ["k1"], vi.fn());
		hover(a);
		expect(container.querySelector(".bs-comment-chip")).not.toBeNull();
		hover(plain);
		expect(container.querySelector(".bs-comment-chip")).toBeNull();
	});

	it("drops the chip when its block stops being commented", () => {
		const a = addBlock("k1");
		const editor = fakeEditor();
		const onBlockClick = vi.fn();
		mount(editor, ["k1"], onBlockClick);
		hover(a);
		expect(container.querySelector(".bs-comment-chip")).not.toBeNull();
		// Last open thread on the block resolved — the id set empties.
		mount(editor, [], onBlockClick);
		expect(container.querySelector(".bs-comment-chip")).toBeNull();
	});
});
