/**
 * Markdown renderer — 9.20.1.5 preview drop.
 *
 * Wraps the pure parser + DOM builder in `logic/markdown-to-dom.ts`. The
 * parser is XSS-safe-by-construction: every user-supplied string becomes
 * a text node, no `innerHTML` anywhere on the path.
 */

import { parseMarkdown, renderBlocksToDom, wordCountForMarkdown } from "../logic/markdown-to-dom";
import { PreviewKind } from "../types/preview-kind";
import type { PreviewInstance, PreviewModule, PreviewMountContext } from "../types/preview-module";
import { decodeSource } from "./text-renderer";

export const markdownRenderer: PreviewModule = {
	kind: PreviewKind.Markdown,
	async mount(context: PreviewMountContext): Promise<PreviewInstance> {
		return mountMarkdown(context);
	},
	async extractMetadata(source) {
		const text = await decodeSource(source);
		return {
			words: String(wordCountForMarkdown(text)),
		};
	},
};

async function mountMarkdown(context: PreviewMountContext): Promise<PreviewInstance> {
	const { host, source } = context;
	host.replaceChildren();

	const stage = document.createElement("div");
	stage.className = "preview-stage preview-stage--markdown";

	const text = await decodeSource(source);
	const blocks = parseMarkdown(text);
	stage.appendChild(renderBlocksToDom(blocks, document));

	host.appendChild(stage);

	return {
		dispose(): void {
			host.replaceChildren();
		},
	};
}
