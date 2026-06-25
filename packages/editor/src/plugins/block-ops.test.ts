// @vitest-environment jsdom
import { CodeNode } from "@lexical/code";
import { createHeadlessEditor } from "@lexical/headless";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import {
	$createListItemNode,
	$createListNode,
	$isListItemNode,
	$isListNode,
	ListItemNode,
	ListNode,
} from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	$isParagraphNode,
	type LexicalEditor,
	type NodeKey,
} from "lexical";
import { describe, expect, it } from "vitest";
import {
	deepCloneNode,
	duplicateBlocks,
	formatTextInBlocks,
	indentBlocks,
	moveBlocksDown,
	moveBlocksTo,
	moveBlocksUp,
} from "./block-ops";

function must<T>(v: T | null | undefined, m: string): T {
	if (v == null) throw new Error(m);
	return v;
}

function createEditor() {
	return createHeadlessEditor({
		nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode, LinkNode, AutoLinkNode],
		onError(error) {
			throw error;
		},
	});
}

function seedThreeParagraphs(editor: LexicalEditor): NodeKey[] {
	const keys: NodeKey[] = [];
	editor.update(
		() => {
			const root = $getRoot();
			root.clear();
			for (const text of ["alpha", "bravo", "charlie"]) {
				const p = $createParagraphNode();
				p.append($createTextNode(text));
				root.append(p);
				keys.push(p.getKey());
			}
		},
		{ discrete: true },
	);
	return keys;
}

function readTopLevelTexts(editor: LexicalEditor): string[] {
	const out: string[] = [];
	editor.getEditorState().read(() => {
		for (const child of $getRoot().getChildren()) {
			out.push(child.getTextContent());
		}
	});
	return out;
}

describe("moveBlocksUp", () => {
	it("is a no-op when the selection is empty", () => {
		const editor = createEditor();
		seedThreeParagraphs(editor);
		moveBlocksUp(editor, new Set());
		expect(readTopLevelTexts(editor)).toEqual(["alpha", "bravo", "charlie"]);
	});

	it("is a no-op when the selection already touches the top", () => {
		const editor = createEditor();
		const keys = seedThreeParagraphs(editor);
		const firstKey = keys[0];
		if (!firstKey) throw new Error("seed produced no first key");
		moveBlocksUp(editor, new Set([firstKey]));
		expect(readTopLevelTexts(editor)).toEqual(["alpha", "bravo", "charlie"]);
	});

	it("shifts a single selected block up by one position", () => {
		const editor = createEditor();
		const keys = seedThreeParagraphs(editor);
		const middle = keys[1];
		if (!middle) throw new Error("seed produced no middle key");
		moveBlocksUp(editor, new Set([middle]));
		expect(readTopLevelTexts(editor)).toEqual(["bravo", "alpha", "charlie"]);
	});

	it("shifts a contiguous multi-block selection up by one position", () => {
		const editor = createEditor();
		const keys = seedThreeParagraphs(editor);
		const middle = keys[1];
		const last = keys[2];
		if (!middle || !last) throw new Error("seed produced no middle/last keys");
		moveBlocksUp(editor, new Set([middle, last]));
		expect(readTopLevelTexts(editor)).toEqual(["bravo", "charlie", "alpha"]);
	});
});

describe("moveBlocksDown", () => {
	it("is a no-op when the selection already touches the bottom", () => {
		const editor = createEditor();
		const keys = seedThreeParagraphs(editor);
		const lastKey = keys[2];
		if (!lastKey) throw new Error("seed produced no last key");
		moveBlocksDown(editor, new Set([lastKey]));
		expect(readTopLevelTexts(editor)).toEqual(["alpha", "bravo", "charlie"]);
	});

	it("shifts a single selected block down by one position", () => {
		const editor = createEditor();
		const keys = seedThreeParagraphs(editor);
		const middle = keys[1];
		if (!middle) throw new Error("seed produced no middle key");
		moveBlocksDown(editor, new Set([middle]));
		expect(readTopLevelTexts(editor)).toEqual(["alpha", "charlie", "bravo"]);
	});

	it("shifts a contiguous multi-block selection down by one position", () => {
		const editor = createEditor();
		const keys = seedThreeParagraphs(editor);
		const first = keys[0];
		const middle = keys[1];
		if (!first || !middle) throw new Error("seed produced no first/middle keys");
		moveBlocksDown(editor, new Set([first, middle]));
		expect(readTopLevelTexts(editor)).toEqual(["charlie", "alpha", "bravo"]);
	});
});

function readIndents(editor: LexicalEditor): number[] {
	const out: number[] = [];
	editor.getEditorState().read(() => {
		for (const child of $getRoot().getChildren()) {
			out.push("getIndent" in child ? (child as { getIndent(): number }).getIndent() : 0);
		}
	});
	return out;
}

describe("indentBlocks", () => {
	it("is a no-op when the selection is empty", () => {
		const editor = createEditor();
		seedThreeParagraphs(editor);
		indentBlocks(editor, new Set(), false);
		expect(readIndents(editor)).toEqual([0, 0, 0]);
	});

	it("bumps every selected block's indent by one level", () => {
		const editor = createEditor();
		const keys = seedThreeParagraphs(editor);
		const [first, , last] = keys;
		if (!first || !last) throw new Error("seed produced no first/last keys");
		indentBlocks(editor, new Set([first, last]), false);
		expect(readIndents(editor)).toEqual([1, 0, 1]);
	});

	it("outdent drops a level and clamps at zero", () => {
		const editor = createEditor();
		const keys = seedThreeParagraphs(editor);
		const middle = keys[1];
		if (!middle) throw new Error("seed produced no middle key");
		// indent twice, then outdent three times → clamped at 0, never negative.
		indentBlocks(editor, new Set([middle]), false);
		indentBlocks(editor, new Set([middle]), false);
		expect(readIndents(editor)).toEqual([0, 2, 0]);
		indentBlocks(editor, new Set([middle]), true);
		indentBlocks(editor, new Set([middle]), true);
		indentBlocks(editor, new Set([middle]), true);
		expect(readIndents(editor)).toEqual([0, 0, 0]);
	});
});

describe("duplicateBlocks", () => {
	it("inserts a copy of each selected block after the last selected one", () => {
		const editor = createEditor();
		const keys = seedThreeParagraphs(editor);
		const middle = keys[1];
		if (!middle) throw new Error("seed produced no middle key");
		const newKeys = duplicateBlocks(editor, new Set([middle]));
		expect(newKeys).toHaveLength(1);
		expect(readTopLevelTexts(editor)).toEqual(["alpha", "bravo", "bravo", "charlie"]);
	});

	it("duplicates multiple selected blocks in document order", () => {
		const editor = createEditor();
		const keys = seedThreeParagraphs(editor);
		const first = keys[0];
		const middle = keys[1];
		if (!first || !middle) throw new Error("seed produced no first/middle keys");
		const newKeys = duplicateBlocks(editor, new Set([first, middle]));
		expect(newKeys).toHaveLength(2);
		expect(readTopLevelTexts(editor)).toEqual(["alpha", "bravo", "alpha", "bravo", "charlie"]);
	});

	it("is a no-op when the selection is empty", () => {
		const editor = createEditor();
		seedThreeParagraphs(editor);
		const newKeys = duplicateBlocks(editor, new Set());
		expect(newKeys).toEqual([]);
		expect(readTopLevelTexts(editor)).toEqual(["alpha", "bravo", "charlie"]);
	});
});

describe("deepCloneNode", () => {
	it("preserves text content and structure", () => {
		const editor = createEditor();
		seedThreeParagraphs(editor);
		let originalContent = "";
		let clonedContent = "";
		let differentKey = false;
		editor.update(() => {
			const first = $getRoot().getFirstChild();
			if (!first || !$isParagraphNode(first)) throw new Error("expected first paragraph");
			originalContent = first.getTextContent();
			const cloned = deepCloneNode(first);
			clonedContent = cloned.getTextContent();
			differentKey = cloned.getKey() !== first.getKey();
		});
		expect(clonedContent).toBe(originalContent);
		expect(clonedContent).toBe("alpha");
		expect(differentKey).toBe(true);
	});
});

describe("moveBlocksTo (drag drop)", () => {
	it("is a no-op when the selection is empty", () => {
		const editor = createEditor();
		const keys = seedThreeParagraphs(editor);
		moveBlocksTo(editor, new Set(), keys[2] ?? null);
		expect(readTopLevelTexts(editor)).toEqual(["alpha", "bravo", "charlie"]);
	});

	it("moves a single block before the target", () => {
		const editor = createEditor();
		const keys = seedThreeParagraphs(editor);
		const charlie = keys[2];
		const alpha = keys[0];
		if (!charlie || !alpha) throw new Error("seed missing keys");
		moveBlocksTo(editor, new Set([charlie]), alpha);
		expect(readTopLevelTexts(editor)).toEqual(["charlie", "alpha", "bravo"]);
	});

	it("moves to the end when target is null", () => {
		const editor = createEditor();
		const keys = seedThreeParagraphs(editor);
		const alpha = keys[0];
		if (!alpha) throw new Error("seed missing keys");
		moveBlocksTo(editor, new Set([alpha]), null);
		expect(readTopLevelTexts(editor)).toEqual(["bravo", "charlie", "alpha"]);
	});

	it("preserves order when dropping multiple blocks", () => {
		const editor = createEditor();
		const keys = seedThreeParagraphs(editor);
		const alpha = keys[0];
		const bravo = keys[1];
		const charlie = keys[2];
		if (!alpha || !bravo || !charlie) throw new Error("seed missing keys");
		// Move {alpha, bravo} before {charlie} — net same order.
		moveBlocksTo(editor, new Set([alpha, bravo]), charlie);
		expect(readTopLevelTexts(editor)).toEqual(["alpha", "bravo", "charlie"]);
	});

	it("is a no-op when the target is the dragged block", () => {
		const editor = createEditor();
		const keys = seedThreeParagraphs(editor);
		const bravo = keys[1];
		if (!bravo) throw new Error("seed missing key");
		moveBlocksTo(editor, new Set([bravo]), bravo);
		expect(readTopLevelTexts(editor)).toEqual(["alpha", "bravo", "charlie"]);
	});

	it("is a no-op when null-target append would re-place an already-last block", () => {
		const editor = createEditor();
		const keys = seedThreeParagraphs(editor);
		const charlie = keys[2];
		if (!charlie) throw new Error("seed missing key");
		moveBlocksTo(editor, new Set([charlie]), null);
		expect(readTopLevelTexts(editor)).toEqual(["alpha", "bravo", "charlie"]);
	});
});

// ─── List-item-as-block ──────────────────────────────────────────────

function seedBulletedList(editor: LexicalEditor, items: readonly string[]): NodeKey[] {
	const keys: NodeKey[] = [];
	editor.update(
		() => {
			const root = $getRoot();
			root.clear();
			const list = $createListNode("bullet");
			for (const text of items) {
				const li = $createListItemNode();
				li.append($createTextNode(text));
				list.append(li);
				keys.push(li.getKey());
			}
			root.append(list);
		},
		{ discrete: true },
	);
	return keys;
}

function readListTexts(editor: LexicalEditor): string[] {
	const out: string[] = [];
	editor.getEditorState().read(() => {
		for (const child of $getRoot().getChildren()) {
			if (!$isListNode(child)) {
				out.push(child.getTextContent());
				continue;
			}
			for (const item of child.getChildren()) {
				if (!$isListItemNode(item)) continue;
				out.push(item.getTextContent());
			}
		}
	});
	return out;
}

describe("moveBlocksUp (list items)", () => {
	it("shifts a single list item up within its parent list", () => {
		const editor = createEditor();
		const keys = seedBulletedList(editor, ["one", "two", "three"]);
		const second = keys[1];
		if (!second) throw new Error("seed missing key");
		moveBlocksUp(editor, new Set([second]));
		expect(readListTexts(editor)).toEqual(["two", "one", "three"]);
	});

	it("is a no-op when the first list-item is at the top of its list", () => {
		const editor = createEditor();
		const keys = seedBulletedList(editor, ["one", "two", "three"]);
		const first = keys[0];
		if (!first) throw new Error("seed missing key");
		moveBlocksUp(editor, new Set([first]));
		expect(readListTexts(editor)).toEqual(["one", "two", "three"]);
	});
});

describe("moveBlocksDown (list items)", () => {
	it("shifts a single list item down within its parent list", () => {
		const editor = createEditor();
		const keys = seedBulletedList(editor, ["one", "two", "three"]);
		const second = keys[1];
		if (!second) throw new Error("seed missing key");
		moveBlocksDown(editor, new Set([second]));
		expect(readListTexts(editor)).toEqual(["one", "three", "two"]);
	});
});

describe("duplicateBlocks (list items)", () => {
	it("duplicates list items inside their parent list, not at root", () => {
		const editor = createEditor();
		const keys = seedBulletedList(editor, ["one", "two", "three"]);
		const second = keys[1];
		if (!second) throw new Error("seed missing key");
		const newKeys = duplicateBlocks(editor, new Set([second]));
		expect(newKeys).toHaveLength(1);
		expect(readListTexts(editor)).toEqual(["one", "two", "two", "three"]);
		// And the doc still has exactly one ListNode wrapping all items.
		editor.getEditorState().read(() => {
			const roots = $getRoot().getChildren();
			expect(roots).toHaveLength(1);
			expect($isListNode(must(roots[0], "roots[0]"))).toBe(true);
		});
	});
});

describe("moveBlocksTo (list items)", () => {
	it("reorders a list item within its parent list", () => {
		const editor = createEditor();
		const keys = seedBulletedList(editor, ["a", "b", "c"]);
		const c = keys[2];
		const a = keys[0];
		if (!c || !a) throw new Error("seed missing keys");
		moveBlocksTo(editor, new Set([c]), a);
		expect(readListTexts(editor)).toEqual(["c", "a", "b"]);
	});
});

// ─── Cross-parent drag (regression coverage) ────────────────────────
//
// These cases used to corrupt the tree — a paragraph dropped on a list
// item ended up as a non-listitem child of the parent ListNode, and a
// list item dropped on a paragraph ended up as a bare ListItemNode at
// root. `moveBlocksTo` now keeps the tree structurally valid: when the
// drop crosses the list/non-list boundary, the dragged block is
// inserted at root (above the containing list when target is a list
// item), and a stray list-item is wrapped in a fresh ListNode.

function readDocumentStructure(editor: LexicalEditor): string {
	let out = "";
	editor.getEditorState().read(() => {
		for (const child of $getRoot().getChildren()) {
			if ($isListNode(child)) {
				out += `[LIST(${child.getListType()}):`;
				for (const item of child.getChildren()) {
					if ($isListItemNode(item)) {
						out += ` LI(${item.getTextContent()})`;
					} else {
						out += ` ???(${item.getType()})`;
					}
				}
				out += "]";
			} else if ($isParagraphNode(child)) {
				out += `[P(${child.getTextContent()})]`;
			} else {
				out += `[${child.getType()}(${child.getTextContent()})]`;
			}
		}
	});
	return out;
}

describe("moveBlocksTo (cross-parent drag)", () => {
	it("drop paragraph onto list item — paragraph lands at root above the list, tree stays valid", () => {
		const editor = createEditor();
		let paragraphKey: NodeKey = "";
		let listItemKey: NodeKey = "";
		editor.update(
			() => {
				const root = $getRoot();
				root.clear();
				const p = $createParagraphNode();
				p.append($createTextNode("para"));
				root.append(p);
				paragraphKey = p.getKey();
				const list = $createListNode("bullet");
				const li1 = $createListItemNode();
				li1.append($createTextNode("item1"));
				const li2 = $createListItemNode();
				li2.append($createTextNode("item2"));
				list.append(li1, li2);
				root.append(list);
				listItemKey = li2.getKey();
			},
			{ discrete: true },
		);
		moveBlocksTo(editor, new Set([paragraphKey]), listItemKey);
		expect(readDocumentStructure(editor)).toBe("[P(para)][LIST(bullet): LI(item1) LI(item2)]");
	});

	it("drop list item onto paragraph — list item wraps in a new list at root, tree stays valid", () => {
		const editor = createEditor();
		let paragraphKey: NodeKey = "";
		let listItemKey: NodeKey = "";
		editor.update(
			() => {
				const root = $getRoot();
				root.clear();
				const list = $createListNode("bullet");
				const li1 = $createListItemNode();
				li1.append($createTextNode("item1"));
				const li2 = $createListItemNode();
				li2.append($createTextNode("item2"));
				list.append(li1, li2);
				root.append(list);
				listItemKey = li1.getKey();
				const p = $createParagraphNode();
				p.append($createTextNode("para"));
				root.append(p);
				paragraphKey = p.getKey();
			},
			{ discrete: true },
		);
		moveBlocksTo(editor, new Set([listItemKey]), paragraphKey);
		// We wrap the orphan list-item in a fresh ListNode at root; Lexical's
		// `ListNode.transform` merges adjacent same-type lists, so the two
		// land in a single bullet list — visually correct, structurally
		// valid.
		expect(readDocumentStructure(editor)).toBe("[LIST(bullet): LI(item2) LI(item1)][P(para)]");
	});

	it("append-at-end of a list item promotes the item to a fresh list at root", () => {
		const editor = createEditor();
		let listItemKey: NodeKey = "";
		editor.update(
			() => {
				const root = $getRoot();
				root.clear();
				const list = $createListNode("bullet");
				const li1 = $createListItemNode();
				li1.append($createTextNode("item1"));
				const li2 = $createListItemNode();
				li2.append($createTextNode("item2"));
				list.append(li1, li2);
				root.append(list);
				listItemKey = li1.getKey();
				const p = $createParagraphNode();
				p.append($createTextNode("para"));
				root.append(p);
			},
			{ discrete: true },
		);
		moveBlocksTo(editor, new Set([listItemKey]), null);
		expect(readDocumentStructure(editor)).toBe(
			"[LIST(bullet): LI(item2)][P(para)][LIST(bullet): LI(item1)]",
		);
	});

	it("simple paragraph→paragraph drag at root still works (regression of basic case)", () => {
		const editor = createEditor();
		const keys = seedThreeParagraphs(editor);
		const bravo = keys[1];
		const alpha = keys[0];
		if (!bravo || !alpha) throw new Error("seed missing keys");
		moveBlocksTo(editor, new Set([bravo]), alpha);
		expect(readTopLevelTexts(editor)).toEqual(["bravo", "alpha", "charlie"]);
	});
});

function readBlockStrike(editor: LexicalEditor): boolean[] {
	const out: boolean[] = [];
	editor.getEditorState().read(() => {
		for (const child of $getRoot().getChildren()) {
			const texts = $isParagraphNode(child) ? child.getAllTextNodes() : [];
			out.push(texts.length > 0 && texts.every((t) => t.hasFormat("strikethrough")));
		}
	});
	return out;
}

describe("formatTextInBlocks", () => {
	it("is a no-op when the selection is empty", () => {
		const editor = createEditor();
		seedThreeParagraphs(editor);
		formatTextInBlocks(editor, new Set(), "strikethrough");
		expect(readBlockStrike(editor)).toEqual([false, false, false]);
	});

	it("strikes the text of every selected block at once", () => {
		const editor = createEditor();
		const keys = seedThreeParagraphs(editor);
		const first = keys[0];
		const last = keys[2];
		if (!first || !last) throw new Error("seed missing keys");
		formatTextInBlocks(editor, new Set([first, last]), "strikethrough");
		expect(readBlockStrike(editor)).toEqual([true, false, true]);
	});

	it("removes the mark when every text node in the selection already has it", () => {
		const editor = createEditor();
		const keys = seedThreeParagraphs(editor);
		const all = new Set(keys);
		formatTextInBlocks(editor, all, "strikethrough");
		expect(readBlockStrike(editor)).toEqual([true, true, true]);
		// Second application toggles the whole selection off.
		formatTextInBlocks(editor, all, "strikethrough");
		expect(readBlockStrike(editor)).toEqual([false, false, false]);
	});

	it("adds the mark everywhere when only part of the selection has it", () => {
		const editor = createEditor();
		const keys = seedThreeParagraphs(editor);
		const first = keys[0];
		if (!first) throw new Error("seed missing first key");
		// Pre-mark just the first block.
		formatTextInBlocks(editor, new Set([first]), "strikethrough");
		expect(readBlockStrike(editor)).toEqual([true, false, false]);
		// Applying across all → mixed state resolves to "all on", not toggle-off.
		formatTextInBlocks(editor, new Set(keys), "strikethrough");
		expect(readBlockStrike(editor)).toEqual([true, true, true]);
	});
});
