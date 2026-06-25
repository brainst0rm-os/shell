// @vitest-environment jsdom
import { createHeadlessEditor } from "@lexical/headless";
import { $createListItemNode, $createListNode, ListItemNode, ListNode } from "@lexical/list";
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalEditor } from "lexical";
import { describe, expect, it } from "vitest";
import { $createEquationNode, EquationNode } from "./nodes/equation-node";
import { blockParentOf, getAllBlocks, isTopLevelBlock, topLevelKeyOf } from "./top-level-block";

function editor(): LexicalEditor {
	return createHeadlessEditor({
		namespace: "tlb",
		nodes: [EquationNode, ListNode, ListItemNode],
		onError: (e) => {
			throw e;
		},
	});
}

describe("isTopLevelBlock", () => {
	it("treats a paragraph (ElementNode) as a block", () => {
		const e = editor();
		e.update(
			() => {
				const p = $createParagraphNode();
				$getRoot().append(p);
				expect(isTopLevelBlock(p)).toBe(true);
			},
			{ discrete: true },
		);
	});

	it("treats a block-level equation (DecoratorNode) as a block — the math-block fix", () => {
		const e = editor();
		e.update(
			() => {
				const block = $createEquationNode("a^2+b^2", false);
				const inline = $createEquationNode("x", true);
				$getRoot().append(block);
				expect(isTopLevelBlock(block)).toBe(true);
				// Inline decorators are NOT blocks (no gutter, not block-selectable).
				expect(isTopLevelBlock(inline)).toBe(false);
			},
			{ discrete: true },
		);
	});
});

describe("topLevelKeyOf", () => {
	it("returns the containing root-child key for a nested text node", () => {
		const e = editor();
		e.update(
			() => {
				const p = $createParagraphNode();
				const t = $createTextNode("hello");
				p.append(t);
				$getRoot().append(p);
				expect(topLevelKeyOf(t)).toBe(p.getKey());
				expect(topLevelKeyOf(p)).toBe(p.getKey());
			},
			{ discrete: true },
		);
	});

	it("returns a top-level decorator's own key (was a throw → 'nothing to select')", () => {
		const e = editor();
		e.update(
			() => {
				const eq = $createEquationNode("E=mc^2", false);
				$getRoot().append(eq);
				expect(topLevelKeyOf(eq)).toBe(eq.getKey());
			},
			{ discrete: true },
		);
	});

	it("returns null for the root itself and for a detached node", () => {
		const e = editor();
		e.update(
			() => {
				expect(topLevelKeyOf($getRoot())).toBeNull();
				expect(topLevelKeyOf($createParagraphNode())).toBeNull();
			},
			{ discrete: true },
		);
	});

	it("returns the containing list-item's key for text inside a bulleted list", () => {
		const e = editor();
		e.update(
			() => {
				const list = $createListNode("bullet");
				const item1 = $createListItemNode();
				const text1 = $createTextNode("one");
				item1.append(text1);
				const item2 = $createListItemNode();
				const text2 = $createTextNode("two");
				item2.append(text2);
				list.append(item1, item2);
				$getRoot().append(list);
				expect(topLevelKeyOf(text1)).toBe(item1.getKey());
				expect(topLevelKeyOf(text2)).toBe(item2.getKey());
				expect(topLevelKeyOf(item1)).toBe(item1.getKey());
			},
			{ discrete: true },
		);
	});

	it("returns the nested list-item's key for text inside a sub-list", () => {
		const e = editor();
		e.update(
			() => {
				const list = $createListNode("bullet");
				const top = $createListItemNode();
				top.append($createTextNode("top"));
				const sub = $createListNode("bullet");
				const nested = $createListItemNode();
				const nestedText = $createTextNode("nested");
				nested.append(nestedText);
				sub.append(nested);
				top.append(sub);
				list.append(top);
				$getRoot().append(list);
				expect(topLevelKeyOf(nestedText)).toBe(nested.getKey());
				expect(topLevelKeyOf(nested)).toBe(nested.getKey());
			},
			{ discrete: true },
		);
	});

	it("returns null when the click landed on the surrounding ListNode itself", () => {
		const e = editor();
		e.update(
			() => {
				const list = $createListNode("bullet");
				$getRoot().append(list);
				expect(topLevelKeyOf(list)).toBeNull();
			},
			{ discrete: true },
		);
	});
});

describe("getAllBlocks", () => {
	it("yields each list-item, not the surrounding ListNode", () => {
		const e = editor();
		let blockKeys: string[] = [];
		let itemKeys: string[] = [];
		e.update(
			() => {
				const para = $createParagraphNode();
				para.append($createTextNode("p"));
				const list = $createListNode("bullet");
				const a = $createListItemNode();
				a.append($createTextNode("a"));
				const b = $createListItemNode();
				b.append($createTextNode("b"));
				list.append(a, b);
				$getRoot().append(para, list);
				itemKeys = [para.getKey(), a.getKey(), b.getKey()];
				blockKeys = getAllBlocks($getRoot()).map((n) => n.getKey());
			},
			{ discrete: true },
		);
		expect(blockKeys).toEqual(itemKeys);
	});

	it("yields nested list-items in DOM order", () => {
		const e = editor();
		let blockKeys: string[] = [];
		let expected: string[] = [];
		e.update(
			() => {
				const list = $createListNode("bullet");
				const top = $createListItemNode();
				top.append($createTextNode("top"));
				const sub = $createListNode("bullet");
				const nested = $createListItemNode();
				nested.append($createTextNode("nested"));
				sub.append(nested);
				top.append(sub);
				const second = $createListItemNode();
				second.append($createTextNode("second"));
				list.append(top, second);
				$getRoot().append(list);
				expected = [top.getKey(), nested.getKey(), second.getKey()];
				blockKeys = getAllBlocks($getRoot()).map((n) => n.getKey());
			},
			{ discrete: true },
		);
		expect(blockKeys).toEqual(expected);
	});
});

describe("isTopLevelBlock", () => {
	it("rejects a bare ListNode (it is a container, not a row)", () => {
		const e = editor();
		e.update(
			() => {
				const list = $createListNode("bullet");
				$getRoot().append(list);
				expect(isTopLevelBlock(list)).toBe(false);
			},
			{ discrete: true },
		);
	});

	it("accepts a ListItemNode (the row)", () => {
		const e = editor();
		e.update(
			() => {
				const list = $createListNode("bullet");
				const item = $createListItemNode();
				list.append(item);
				$getRoot().append(list);
				expect(isTopLevelBlock(item)).toBe(true);
			},
			{ discrete: true },
		);
	});
});

describe("blockParentOf", () => {
	it("returns the parent ListNode for a list item", () => {
		const e = editor();
		e.update(
			() => {
				const list = $createListNode("bullet");
				const item = $createListItemNode();
				list.append(item);
				$getRoot().append(list);
				expect(blockParentOf(item)).toBe(list);
			},
			{ discrete: true },
		);
	});

	it("returns root for a paragraph at root", () => {
		const e = editor();
		e.update(
			() => {
				const p = $createParagraphNode();
				$getRoot().append(p);
				expect(blockParentOf(p)).toBe($getRoot());
			},
			{ discrete: true },
		);
	});
});
