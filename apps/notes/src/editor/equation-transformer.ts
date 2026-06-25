/**
 * Markdown shortcut for inline maths: typing `$E=mc^2$` converts to an
 * inline EquationNode (and exports back to the same `$…$` syntax so a
 * round-trip through markdown is lossless). Block equations come from
 * the slash command. Added to the MarkdownShortcutPlugin transformer
 * list rather than a bespoke plugin so it shares the existing typing
 * pipeline.
 */

import type { TextMatchTransformer } from "@lexical/markdown";
import type { LexicalNode, TextNode } from "lexical";
import { $createEquationNode, $isEquationNode, EquationNode } from "./nodes/equation-node";

export const EQUATION_TRANSFORMER: TextMatchTransformer = {
	dependencies: [EquationNode],
	export: (node: LexicalNode) =>
		$isEquationNode(node) && node.isInline() ? `$${node.getEquation()}$` : null,
	importRegExp: /\$([^$]+?)\$/,
	regExp: /\$([^$]+?)\$$/,
	replace: (textNode: TextNode, match: RegExpMatchArray) => {
		const [, equation] = match;
		if (!equation) return;
		textNode.replace($createEquationNode(equation, true));
	},
	trigger: "$",
	type: "text-match",
};
