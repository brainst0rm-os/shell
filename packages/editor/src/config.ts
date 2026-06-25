/**
 * The pre-configured Lexical editor contract. One place defines the
 * namespace default, the baseline node set, the theme, and the error
 * handler so every Brainstorm editor surface is configured identically
 * (§A pre-configured Lexical factory).
 *
 * `editorState` is intentionally absent: Brainstorm Lexical is *always*
 * Yjs-backed (07 §Decision: there is no non-collaborative mode), so the
 * `@lexical/yjs` collaboration plugin owns initial state — passing an
 * `editorState` here would conflict with it.
 */

import type { EditorThemeClasses, Klass, LexicalNode } from "lexical";
import { BASELINE_NODES } from "./nodes";
import { mergeTheme } from "./theme";

export const DEFAULT_EDITOR_NAMESPACE = "brainstorm-editor" as const;

export type BrainstormEditorConfigOptions = {
	/** Lexical namespace — distinguishes editors for copy/paste + history.
	 *  Defaults to `"brainstorm-editor"`. */
	namespace?: string;
	/** Theme overrides merged onto the baseline (see `mergeTheme`). */
	theme?: EditorThemeClasses;
	/** `false` renders the read/locked editor (still Yjs-backed). */
	editable?: boolean;
	/** Lexical reconciliation error handler. Defaults to `console.error`. */
	onError?: (error: Error) => void;
};

export type BrainstormInitialConfig = {
	namespace: string;
	theme: EditorThemeClasses;
	editable: boolean;
	nodes: ReadonlyArray<Klass<LexicalNode>>;
	onError: (error: Error) => void;
	editorState: null;
};

export function createEditorConfig(
	options: BrainstormEditorConfigOptions = {},
): BrainstormInitialConfig {
	return {
		namespace: options.namespace ?? DEFAULT_EDITOR_NAMESPACE,
		theme: mergeTheme(options.theme),
		editable: options.editable ?? true,
		nodes: BASELINE_NODES,
		onError:
			options.onError ??
			((error: Error) => {
				console.error("[brainstorm-editor]", error);
			}),
		editorState: null,
	};
}
