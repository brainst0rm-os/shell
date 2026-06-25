/**
 * InitialFocusPlugin — focus the editor's TitleNode on first mount.
 *
 * The new-note bug this fixes: `makeNoteBootstrap("")` appends an empty
 * TitleNode + empty paragraph for a freshly-created note. The empty
 * TitleNode is invisible (no text → no cursor anchor), so the browser's
 * natural focus order picks the first focusable element in the DOM —
 * that's the icon-picker `<button>` in the chrome, which sits BEFORE the
 * editor's contenteditable. The user then sees the icon button outlined,
 * presses a key thinking they're titling the note, and only after the
 * first keystroke (which the editor catches via its global keydown
 * listener) does the title field "appear" and accept input.
 *
 * Fix: explicitly focus the editor on mount and place the selection at
 * the end of the TitleNode, so the cursor blinks where the user expects
 * to type — in an empty title that's the only spot; in an existing title
 * it's after the last character, not before the first. The launcher and cheatsheet
 * both use the same `requestAnimationFrame(() => focus())` pattern to
 * defer past the parent component's entrance animation; this mirrors it.
 *
 * Idempotent + safe: only runs once per editor mount. The caller's
 * `key={noteId}` discipline on `<Editor>` gets a fresh focus per note
 * switch automatically. A note that already has body content takes the
 * same path — focusing the editor in that case is harmless (the user
 * can still click elsewhere); the dominant case it handles is the empty
 * new-note path where focus was previously lost to the icon button.
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot, $isElementNode, type ElementNode } from "lexical";
import { useEffect } from "react";

export function InitialFocusPlugin() {
	const [editor] = useLexicalComposerContext();
	useEffect(() => {
		// Defer to the next frame so the parent Notes app's render +
		// CollaborationPlugin's hydration settle before we ask Lexical
		// for the selection. Mirrors the launcher / cheatsheet pattern.
		const raf = requestAnimationFrame(() => {
			editor.focus(
				() => {
					editor.update(
						() => {
							const root = $getRoot();
							// Land on the first block that actually paints. Journal
							// hides its TitleNode (`display: none` — the day chrome
							// owns the date), so selecting `getFirstChild()` blindly
							// parks the caret in a node with no box and focus reads as
							// lost. Skip past any first child whose DOM element isn't
							// rendered.
							let target: ElementNode | null = null;
							for (const child of root.getChildren()) {
								if (!$isElementNode(child)) continue;
								const el = editor.getElementByKey(child.getKey());
								if (el && el.offsetParent !== null) {
									target = child;
									break;
								}
								if (!target) target = child;
							}
							target?.selectEnd();
						},
						{ tag: "history-merge" },
					);
				},
				{ defaultSelection: "rootStart" },
			);
		});
		return () => cancelAnimationFrame(raf);
	}, [editor]);
	return null;
}
