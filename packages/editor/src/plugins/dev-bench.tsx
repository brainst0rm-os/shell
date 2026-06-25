/**
 * Shared dev/test primitives for the keystroke-safe editor harness.
 *
 * Dispatching synthetic keystrokes against a Yjs-bound Lexical editor in
 * headless Electron corrupts the collab doc (the binding races the input
 * events), so the Playwright dogfood / perf harness mutates the editor
 * model directly instead. Notes was the first consumer
 * (`apps/notes/src/editor/dev-bench-plugin.tsx`); Journal is the second
 * (`apps/journal/src/ui/journal-dev-plugin.tsx`). These two primitives —
 * capturing the live editor and a keystroke-free paragraph append — are
 * the genuinely shared core; each per-app adapter still owns its own
 * `window.__brainstorm<App>Dev` surface (the method set differs per app).
 *
 * Follow-up: migrate the Notes adapter onto these primitives too — it
 * still inlines its own copy of the capture + appendParagraph logic
 * (kept untouched here to avoid regressing the many sessions that depend
 * on `__brainstormNotesDev`).
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalEditor } from "lexical";
import { type ReactElement, useEffect } from "react";

/**
 * Capture the live `LexicalEditor` the moment it mounts. Mount inside a
 * `<BrainstormEditor>` as a child; `onMount` fires with the editor and
 * `onUnmount` on teardown, so a per-app dev adapter can install its
 * window global against the real instance.
 */
export function EditorCapturePlugin({
	onMount,
	onUnmount,
}: {
	onMount: (editor: LexicalEditor) => void;
	onUnmount?: (editor: LexicalEditor) => void;
}): ReactElement | null {
	const [editor] = useLexicalComposerContext();
	useEffect(() => {
		onMount(editor);
		return () => onUnmount?.(editor);
	}, [editor, onMount, onUnmount]);
	return null;
}

/**
 * Append a paragraph with `text` to the doc root via a discrete
 * transaction (commits + reconciles synchronously), then wait a double
 * rAF so the contenteditable has painted before the caller continues —
 * the keystroke-free way to seed recognizable body content.
 */
export async function devAppendParagraph(editor: LexicalEditor, text: string): Promise<void> {
	editor.update(
		() => {
			const p = $createParagraphNode();
			p.append($createTextNode(text));
			$getRoot().append(p);
		},
		{ discrete: true },
	);
	await new Promise<void>((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
	});
}
