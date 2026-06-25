/**
 * Plain-text renderer — 9.20.1.5 preview drop.
 *
 * `<pre>` block with word-wrap. The renderer reads bytes-or-URL into a
 * string via `decodeSource`, then writes it through `textContent` (never
 * `innerHTML`) so a hostile text file can't smuggle in HTML.
 *
 * Word-wrap is a v1 stance — long lines wrap by default because Quick-
 * Look-style is for at-a-glance reading, not source-archeology. 9.20.4
 * (code renderer) ships horizontal-scroll mode for source files.
 */

import { PreviewKind } from "../types/preview-kind";
import type {
	PreviewInstance,
	PreviewModule,
	PreviewMountContext,
	PreviewSource,
} from "../types/preview-module";

export const textRenderer: PreviewModule = {
	kind: PreviewKind.Text,
	async mount(context: PreviewMountContext): Promise<PreviewInstance> {
		return mountText(context);
	},
	async extractMetadata(source) {
		const text = await decodeSource(source);
		return {
			lines: String(countLines(text)),
			characters: String(text.length),
		};
	},
};

async function mountText(context: PreviewMountContext): Promise<PreviewInstance> {
	const { host, source } = context;
	host.replaceChildren();

	const stage = document.createElement("div");
	stage.className = "preview-stage preview-stage--text";

	const pre = document.createElement("pre");
	pre.className = "preview-text";
	const code = document.createElement("code");
	code.textContent = await decodeSource(source);
	pre.appendChild(code);

	stage.appendChild(pre);
	host.appendChild(stage);

	return {
		dispose(): void {
			host.replaceChildren();
		},
	};
}

export async function decodeSource(source: PreviewSource): Promise<string> {
	if (source.kind === "bytes") return new TextDecoder().decode(source.bytes);
	const response = await fetch(source.url);
	return await response.text();
}

function countLines(text: string): number {
	if (text.length === 0) return 0;
	let count = 1;
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "\n") count++;
	}
	// Trailing newline shouldn't inflate the count.
	if (text.endsWith("\n")) count--;
	return Math.max(count, 1);
}
