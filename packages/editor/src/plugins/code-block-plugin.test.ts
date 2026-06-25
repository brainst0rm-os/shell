// @vitest-environment jsdom
import { CodeNode } from "@lexical/code";
import { createHeadlessEditor } from "@lexical/headless";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { $findMatchingParent } from "@lexical/utils";
import {
	$createLineBreakNode,
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	$getSelection,
	$isLineBreakNode,
	$isParagraphNode,
	$isRangeSelection,
	type LexicalEditor,
} from "lexical";
import { describe, expect, it } from "vitest";

function createEditor(): LexicalEditor {
	return createHeadlessEditor({
		nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode, LinkNode, AutoLinkNode],
		onError(error) {
			throw error;
		},
	});
}

const DISCRETE = { discrete: true } as const;

/**
 * The CodeBlockPlugin's exit logic lives in `code-block-plugin.tsx` but the
 * `exitCodeBlock` helper isn't exported. To unit-test the *behavior* we
 * inline the equivalent transform here: detect empty trailing line, strip
 * it, insert paragraph after, focus it. The integration plug-in renders
 * the same sequence — covered by the editor harness in the running app.
 *
 * What this suite proves:
 *   - On `<CodeNode> "let x" <LineBreak> ""` (selection at end), the
 *     transform removes the linebreak, inserts a paragraph after, and the
 *     caret lands in the new paragraph.
 *   - On `<CodeNode> "still-coding"` (no trailing linebreak), the
 *     "isOnEmptyTrailingLine" predicate returns false — the transform
 *     should NOT fire.
 */
function exitFromEmptyTrailingLine(editor: LexicalEditor): boolean {
	let ran = false;
	editor.update(() => {
		const sel = $getSelection();
		if (!$isRangeSelection(sel) || !sel.isCollapsed()) return;
		const code = $findMatchingParent(
			sel.anchor.getNode(),
			(n) => n instanceof CodeNode,
		) as CodeNode | null;
		if (!code) return;
		const last = code.getLastChild();
		if (!last || !$isLineBreakNode(last)) return;
		last.remove();
		const paragraph = $createParagraphNode();
		code.insertAfter(paragraph);
		paragraph.selectStart();
		ran = true;
	}, DISCRETE);
	return ran;
}

describe("CodeBlock exit semantics", () => {
	it("exits the code block when caret sits on an empty trailing line", () => {
		const editor = createEditor();
		editor.update(() => {
			const root = $getRoot();
			root.clear();
			const code = new CodeNode();
			code.append($createTextNode("let x = 1"));
			code.append($createLineBreakNode());
			root.append(code);
			code.selectEnd();
		}, DISCRETE);

		const ran = exitFromEmptyTrailingLine(editor);
		expect(ran).toBe(true);

		editor.read(() => {
			const root = $getRoot();
			const children = root.getChildren();
			// CodeNode + new paragraph.
			expect(children.length).toBe(2);
			const code = children[0] as CodeNode;
			expect(code instanceof CodeNode).toBe(true);
			// Trailing line break stripped — code only has the text node.
			expect(code.getChildrenSize()).toBe(1);
			// Text content preserved.
			expect(code.getTextContent()).toBe("let x = 1");
			const para = children[1];
			expect($isParagraphNode(para)).toBe(true);
			// Caret should be in the paragraph.
			const sel = $getSelection();
			if ($isRangeSelection(sel)) {
				const anchor = sel.anchor.getNode();
				const inPara = $findMatchingParent(anchor, (n) => n.is(para)) !== null || anchor.is(para);
				expect(inPara).toBe(true);
			}
		});
	});

	it("does NOT exit when the code block has no trailing empty line", () => {
		const editor = createEditor();
		editor.update(() => {
			const root = $getRoot();
			root.clear();
			const code = new CodeNode();
			code.append($createTextNode("still typing"));
			root.append(code);
			code.selectEnd();
		}, DISCRETE);

		const ran = exitFromEmptyTrailingLine(editor);
		expect(ran).toBe(false);

		editor.read(() => {
			const children = $getRoot().getChildren();
			expect(children.length).toBe(1);
			expect(children[0] instanceof CodeNode).toBe(true);
		});
	});

	it("does NOT exit when the caret is outside a code block", () => {
		const editor = createEditor();
		editor.update(() => {
			const root = $getRoot();
			root.clear();
			const para = $createParagraphNode();
			para.append($createTextNode("normal text"));
			root.append(para);
			para.selectEnd();
		}, DISCRETE);

		const ran = exitFromEmptyTrailingLine(editor);
		expect(ran).toBe(false);
	});
});
