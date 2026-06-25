/**
 * EditorHandlePlugin — captures the live `LexicalEditor` into a ref the app
 * owns, so surfaces outside the composer (the header object menu's Export…
 * entries, B11.12) can read the current `SerializedEditorState` on demand
 * without threading state through the gated autosave callback.
 *
 * Production counterpart to the dev-bench capture: that one feeds the test
 * harness's module global; this one hands the editor to a caller-supplied ref
 * and clears it on unmount so a stale editor can't outlive its note.
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { LexicalEditor } from "lexical";
import { type MutableRefObject, useEffect } from "react";

export function EditorHandlePlugin({
	handleRef,
}: {
	handleRef: MutableRefObject<LexicalEditor | null>;
}): null {
	const [editor] = useLexicalComposerContext();
	useEffect(() => {
		handleRef.current = editor;
		return () => {
			if (handleRef.current === editor) handleRef.current = null;
		};
	}, [editor, handleRef]);
	return null;
}
