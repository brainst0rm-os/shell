/**
 * Block-level Markdown shortcuts that `@lexical/markdown`'s default
 * `TRANSFORMERS` set leaves out — so typing them never converted even though
 * the To-do-list and Divider blocks (and their plugins) are mounted:
 *
 *   • `CHECK_LIST` — `[] ` / `[ ] ` / `[x] ` (optionally after `- `) → a
 *     checklist item. Re-exported from `@lexical/markdown`; it just isn't in
 *     the default array.
 *   • `HR_TRANSFORMER` — `---` / `***` / `___` on its own line → a horizontal
 *     rule. `@lexical/markdown` ships no HR transformer, so this is the
 *     canonical Lexical-playground one, defined once here.
 *
 * Both are prepended *before* the default transformers in every editor's list
 * so `CHECK_LIST` wins over `UNORDERED_LIST` for the `- [ ] ` case (first
 * matching transformer wins). Paired with the export side in
 * `serialize-markdown.ts` (the `horizontalrule` case) so a divider round-trips.
 */

import { CHECK_LIST, type ElementTransformer } from "@lexical/markdown";
import {
	$createHorizontalRuleNode,
	$isHorizontalRuleNode,
	HorizontalRuleNode,
} from "@lexical/react/LexicalHorizontalRuleNode";
import type { LexicalNode } from "lexical";

export const HR_TRANSFORMER: ElementTransformer = {
	dependencies: [HorizontalRuleNode],
	export: (node: LexicalNode) => ($isHorizontalRuleNode(node) ? "---" : null),
	// `---` / `***` / `___`, plus the em-dash-mangled forms `—-` and `——`: Notes'
	// `--`→`—` typing shortcut fires on the 2nd hyphen, so a typed `---` arrives
	// as `—-` (and `----` as `——`) before this transformer ever sees three ASCII
	// hyphens. Matching the mangled forms lets the muscle-memory `---` divider
	// gesture still work in Notes; they never occur naturally in the other
	// editors (no such shortcut there), so this is harmless everywhere else.
	regExp: /^(---|\*\*\*|___|—-|——)\s?$/,
	replace: (parentNode, _children, _match, isImport) => {
		const line = $createHorizontalRuleNode();
		if (isImport || parentNode.getNextSibling() != null) {
			parentNode.replace(line);
		} else {
			parentNode.insertBefore(line);
		}
		line.selectNext();
	},
	type: "element",
};

/** Prepend to a `MarkdownShortcutPlugin` transformer list to enable the
 *  checklist + divider shortcuts (order matters — these go before the default
 *  list transformers). */
export const BLOCK_MARKDOWN_TRANSFORMERS: readonly ElementTransformer[] = [
	CHECK_LIST,
	HR_TRANSFORMER,
];
