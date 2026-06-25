/**
 * Headless editor over the baseline node set — no DOM, no React. Used by
 * the serialization paths and tests (`@lexical/headless`'s
 * `createHeadlessEditor`), single-sourcing `BASELINE_NODES` so headless
 * and rendered editors can never drift.
 */

import { createHeadlessEditor } from "@lexical/headless";
import type { LexicalEditor } from "lexical";
import { type BrainstormEditorConfigOptions, createEditorConfig } from "./config";

export function createBrainstormHeadlessEditor(
	options: BrainstormEditorConfigOptions = {},
): LexicalEditor {
	const config = createEditorConfig(options);
	return createHeadlessEditor({
		namespace: config.namespace,
		nodes: [...config.nodes],
		editable: config.editable,
		onError: config.onError,
	});
}
