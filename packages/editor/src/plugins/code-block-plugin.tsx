/**
 * CodeBlockPlugin — code-block UX layer.
 *
 * Exit semantics (the user-expected "Enter escapes code" behavior):
 *   - **Mod+Enter** — always exits, anywhere inside the block. The
 *     conventional escape hatch when the user wants out without leaving
 *     an empty line behind.
 *   - **Enter** on an empty trailing line — also exits. Mirrors Notion /
 *     Markdown editors: type a newline at the end, press Enter again,
 *     you're out. The empty trailing newline gets stripped so the code
 *     block doesn't keep an orphan blank line.
 *   - **Enter** elsewhere — keeps Lexical's default (insert newline).
 *     Multiline code is essential.
 *
 * Syntax highlighting deliberately NOT wired here. `@lexical/code`'s
 * `registerCodeHighlighting` uses Prism, which we're choosing to avoid
 * in favour of Shiki (matches the code-editor app's choice + better
 * TextMate grammars). Shiki integration lands in a follow-up — needs a
 * custom decorator pipeline since Lexical doesn't ship a Shiki adapter.
 *
 * Phase B (follow-up, task #66): Shiki-based highlighting,
 * language-selector dropdown, copy button, wrap / unwrap toggle.
 */

import { CodeNode } from "@lexical/code";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $findMatchingParent, mergeRegister } from "@lexical/utils";
import {
	$createParagraphNode,
	$getSelection,
	$isLineBreakNode,
	$isRangeSelection,
	COMMAND_PRIORITY_HIGH,
	KEY_ENTER_COMMAND,
	type LexicalEditor,
} from "lexical";
import { useCallback, useEffect } from "react";
import { useEditorShortcut } from "./editor-shortcut";

const DISCRETE = { discrete: true } as const;

/** Mod+Enter exits a code block (escape to a trailing paragraph). */
const EXIT_CODE_BLOCK_CHORDS = ["Mod+Enter"] as const;

export function CodeBlockPlugin() {
	const [editor] = useLexicalComposerContext();

	const onModEnterExit = useCallback(
		(event: KeyboardEvent) => {
			if (!isSelectionInsideCode(editor)) return;
			event.preventDefault();
			editor.update(exitCodeBlock, DISCRETE);
		},
		[editor],
	);

	useEditorShortcut(EXIT_CODE_BLOCK_CHORDS, onModEnterExit);

	useEffect(() => {
		// Plain Enter on an empty trailing line inside code → exit.
		// Registered at HIGH priority so we preempt Lexical's default
		// newline-insertion when the condition is met; otherwise we
		// return false and let Lexical run normally.
		return mergeRegister(
			editor.registerCommand(
				KEY_ENTER_COMMAND,
				(event) => {
					if (!isOnEmptyTrailingLineOfCode(editor)) return false;
					event?.preventDefault();
					editor.update(exitCodeBlock, DISCRETE);
					return true;
				},
				COMMAND_PRIORITY_HIGH,
			),
		);
	}, [editor]);

	return null;
}

function isSelectionInsideCode(editor: LexicalEditor): boolean {
	let inCode = false;
	editor.getEditorState().read(() => {
		const sel = $getSelection();
		if (!$isRangeSelection(sel)) return;
		const anchor = sel.anchor.getNode();
		inCode = $findMatchingParent(anchor, (n) => n instanceof CodeNode) !== null;
	});
	return inCode;
}

function isOnEmptyTrailingLineOfCode(editor: LexicalEditor): boolean {
	let yes = false;
	editor.getEditorState().read(() => {
		const sel = $getSelection();
		if (!$isRangeSelection(sel) || !sel.isCollapsed()) return;
		const anchor = sel.anchor.getNode();
		const code = $findMatchingParent(anchor, (n) => n instanceof CodeNode);
		if (!code) return;
		// Walk to the last descendant of the code block and verify the
		// caret is on the same line as a trailing LineBreakNode (so the
		// "current line" is empty AND is the last line).
		const last = code.getLastChild();
		if (!last) {
			// Empty code block — Enter on it should exit.
			yes = true;
			return;
		}
		if (!$isLineBreakNode(last)) return;
		// The trailing element is a line break — i.e. the visible last
		// line is empty. Make sure the caret is at the end (anchor is
		// either the line break itself or a position after it).
		const lastKey = last.getKey();
		const anchorKey = sel.anchor.getNode().getKey();
		// Lexical sometimes targets the parent on "after-last-child" — accept
		// both: anchor is the linebreak node, or anchor is the code node
		// with offset === children.length.
		if (anchorKey === lastKey) {
			yes = true;
			return;
		}
		if (anchorKey === code.getKey() && sel.anchor.offset === code.getChildrenSize()) {
			yes = true;
		}
	});
	return yes;
}

function exitCodeBlock(): void {
	const sel = $getSelection();
	if (!$isRangeSelection(sel)) return;
	const anchor = sel.anchor.getNode();
	const code = $findMatchingParent(anchor, (n) => n instanceof CodeNode);
	if (!code) return;
	// Strip a trailing empty line (LineBreakNode) so the user doesn't
	// leave an orphaned blank inside the code block.
	const last = code.getLastChild();
	if (last && $isLineBreakNode(last)) {
		last.remove();
	}
	const paragraph = $createParagraphNode();
	code.insertAfter(paragraph);
	paragraph.selectStart();
}
