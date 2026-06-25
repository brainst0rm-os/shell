import { createHeadlessEditor } from "@lexical/headless";
import { $createListItemNode, $createListNode, ListNode } from "@lexical/list";
import { $createHeadingNode } from "@lexical/rich-text";
import {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	DecoratorNode,
	type LexicalEditor,
	type LexicalNode,
	type NodeKey,
} from "lexical";
import { describe, expect, it } from "vitest";
import { BASELINE_NODES } from "./nodes";
import { blockParentOf, getAllBlocks, isTopLevelBlock, topLevelKeyOf } from "./top-level-block";

/** A block-level decorator (`isInline() → false`) for the "non-inline decorator
 *  is a block" assertion. Concrete DecoratorNode default returns `true`, so we
 *  need an override to model the embed / image / math / video case. */
class BlockDecorator extends DecoratorNode<null> {
	static override getType(): string {
		return "test-block-decorator";
	}
	static override clone(node: BlockDecorator): BlockDecorator {
		return new BlockDecorator(node.__key);
	}
	override isInline(): boolean {
		return false;
	}
	override createDOM(): HTMLElement {
		return document.createElement("div");
	}
	override updateDOM(): false {
		return false;
	}
	override decorate(): null {
		return null;
	}
}

/** An inline decorator (`isInline() → true`) — mention / inline-equation pattern. */
class InlineDecorator extends DecoratorNode<null> {
	static override getType(): string {
		return "test-inline-decorator";
	}
	static override clone(node: InlineDecorator): InlineDecorator {
		return new InlineDecorator(node.__key);
	}
	override isInline(): boolean {
		return true;
	}
	override createDOM(): HTMLElement {
		return document.createElement("span");
	}
	override updateDOM(): false {
		return false;
	}
	override decorate(): null {
		return null;
	}
}

function editorWithDecorators(): LexicalEditor {
	return createHeadlessEditor({
		namespace: "test-top-level-block",
		nodes: [...BASELINE_NODES, BlockDecorator, InlineDecorator],
		onError: (e: Error) => {
			throw e;
		},
	});
}

function runIn<T>(editor: LexicalEditor, fn: () => T): T {
	let out!: T;
	editor.update(
		() => {
			out = fn();
		},
		{ discrete: true },
	);
	return out;
}

describe("isTopLevelBlock", () => {
	it("returns true for a plain paragraph", () => {
		const editor = editorWithDecorators();
		const result = runIn(editor, () => isTopLevelBlock($createParagraphNode()));
		expect(result).toBe(true);
	});

	it("returns true for a heading", () => {
		const editor = editorWithDecorators();
		const result = runIn(editor, () => isTopLevelBlock($createHeadingNode("h1")));
		expect(result).toBe(true);
	});

	it("returns false for a ListNode (the list is a container, not a row)", () => {
		const editor = editorWithDecorators();
		const result = runIn(editor, () => isTopLevelBlock($createListNode("bullet")));
		expect(result).toBe(false);
	});

	it("returns true for a ListItemNode (each item IS a block)", () => {
		const editor = editorWithDecorators();
		const result = runIn(editor, () => isTopLevelBlock($createListItemNode()));
		expect(result).toBe(true);
	});

	it("returns true for a non-inline decorator (block-level embed)", () => {
		const editor = editorWithDecorators();
		const result = runIn(editor, () => isTopLevelBlock(new BlockDecorator()));
		expect(result).toBe(true);
	});

	it("returns false for an inline decorator (mention / inline equation)", () => {
		const editor = editorWithDecorators();
		const result = runIn(editor, () => isTopLevelBlock(new InlineDecorator()));
		expect(result).toBe(false);
	});
});

describe("topLevelKeyOf", () => {
	it("for a text node inside a paragraph → paragraph's key", () => {
		const editor = editorWithDecorators();
		const { expected, actual } = runIn(editor, () => {
			const root = $getRoot();
			root.clear();
			const para = $createParagraphNode();
			const text = $createTextNode("hi");
			para.append(text);
			root.append(para);
			return { expected: para.getKey(), actual: topLevelKeyOf(text) };
		});
		expect(actual).toBe(expected);
	});

	it("for a text node inside a list-item → the list-item's key (NOT the list's)", () => {
		const editor = editorWithDecorators();
		const { itemKey, listKey, actual } = runIn(editor, () => {
			const root = $getRoot();
			root.clear();
			const list = $createListNode("bullet");
			const item = $createListItemNode();
			const text = $createTextNode("one");
			item.append(text);
			list.append(item);
			root.append(list);
			return { itemKey: item.getKey(), listKey: list.getKey(), actual: topLevelKeyOf(text) };
		});
		expect(actual).toBe(itemKey);
		expect(actual).not.toBe(listKey);
	});

	it("for the root itself → null", () => {
		const editor = editorWithDecorators();
		const result = runIn(editor, () => topLevelKeyOf($getRoot()));
		expect(result).toBeNull();
	});

	it("for a detached node (no parent) → null", () => {
		const editor = editorWithDecorators();
		const result = runIn(editor, () => topLevelKeyOf($createParagraphNode()));
		expect(result).toBeNull();
	});

	it("for a bare ListNode placed directly under root → null (the list has no row identity)", () => {
		const editor = editorWithDecorators();
		const result = runIn(editor, () => {
			const root = $getRoot();
			root.clear();
			const list = $createListNode("bullet");
			root.append(list);
			return topLevelKeyOf(list);
		});
		expect(result).toBeNull();
	});
});

describe("getAllBlocks", () => {
	it("yields a paragraph + each list-item (in order) for [paragraph, list[a, b]]", () => {
		const editor = editorWithDecorators();
		const { result, expected } = runIn(editor, () => {
			const root = $getRoot();
			root.clear();
			const para = $createParagraphNode();
			const list = $createListNode("bullet");
			const itemA = $createListItemNode();
			const itemB = $createListItemNode();
			list.append(itemA, itemB);
			root.append(para, list);
			return {
				result: getAllBlocks(root).map((n) => n.getKey()),
				expected: [para.getKey(), itemA.getKey(), itemB.getKey()],
			};
		});
		expect(result).toEqual(expected);
	});

	it("recurses through nested list-items: [heading, list[a[list[b]]]] → [heading, a, b]", () => {
		const editor = editorWithDecorators();
		const { result, expected } = runIn(editor, () => {
			const root = $getRoot();
			root.clear();
			const heading = $createHeadingNode("h2");
			const outer = $createListNode("bullet");
			const a = $createListItemNode();
			const inner = $createListNode("bullet");
			const b = $createListItemNode();
			inner.append(b);
			a.append(inner);
			outer.append(a);
			root.append(heading, outer);
			return {
				result: getAllBlocks(root).map((n) => n.getKey()),
				expected: [heading.getKey(), a.getKey(), b.getKey()],
			};
		});
		expect(result).toEqual(expected);
	});

	it("returns an empty array when given a non-element node", () => {
		const editor = editorWithDecorators();
		const result = runIn(editor, () => getAllBlocks($createTextNode("x") as unknown as LexicalNode));
		expect(result).toEqual([]);
	});
});

describe("blockParentOf", () => {
	it("for a list-item → its parent ListNode", () => {
		const editor = editorWithDecorators();
		const { actual, expectedKey } = runIn(editor, () => {
			const root = $getRoot();
			root.clear();
			const list = $createListNode("bullet");
			const item = $createListItemNode();
			list.append(item);
			root.append(list);
			return { actual: blockParentOf(item), expectedKey: list.getKey() };
		});
		expect(actual).toBeInstanceOf(ListNode);
		expect(actual?.getKey()).toBe(expectedKey);
	});

	it("for a paragraph at root → returns root", () => {
		const editor = editorWithDecorators();
		const { actual, rootKey } = runIn(editor, () => {
			const root = $getRoot();
			root.clear();
			const para = $createParagraphNode();
			root.append(para);
			return { actual: blockParentOf(para), rootKey: root.getKey() };
		});
		expect(actual?.getKey()).toBe(rootKey);
	});

	it("for a detached text node → null", () => {
		const editor = editorWithDecorators();
		const result = runIn(editor, () => blockParentOf($createTextNode("x")));
		expect(result).toBeNull();
	});
});
