/**
 * EditablePlugin — drive the editor's `editable` flag at runtime.
 *
 * `LexicalComposer`'s `initialConfig.editable` only applies at creation,
 * so a page-level lock toggle (B11.11) that flips read-only without
 * remounting the composer needs an imperative `editor.setEditable(...)`.
 * This plugin owns that single side-effect: whenever the `editable` prop
 * changes, it pushes the new value onto the live editor. Locking blurs
 * the contenteditable so the caret can't linger in a now-read-only doc.
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect } from "react";

export type EditablePluginProps = {
	/** When false the whole document is read-only (page-level lock). */
	editable: boolean;
};

export function EditablePlugin({ editable }: EditablePluginProps): null {
	const [editor] = useLexicalComposerContext();
	useEffect(() => {
		if (editor.isEditable() === editable) return;
		editor.setEditable(editable);
		if (!editable) editor.getRootElement()?.blur();
	}, [editor, editable]);
	return null;
}
