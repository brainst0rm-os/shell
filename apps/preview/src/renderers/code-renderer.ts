/**
 * Code renderer — 9.20.4.
 *
 * Quick-Look-grade *readable* source view: a line-number gutter + a
 * non-wrapping monospaced body that scrolls horizontally (source needs
 * column fidelity — the opposite stance to the plain-text renderer's
 * word-wrap, as that renderer's header forward-references). Language is
 * auto-detected from filename / MIME / shebang and surfaced in the
 * inspector.
 *
 * Syntax *highlighting* (Shiki, shared with code-editor 9.7) is a later
 * rung — `shiki` isn't a workspace dep yet, so per [[preview-drop-
 * pattern]] this ships the structural view now; the Shiki swap consumes
 * `detectCodeLanguage`'s result and only changes the paint, not this
 * contract. Content is written via `textContent` only — a hostile source
 * file can never smuggle markup into the pane (same stance as the text /
 * markdown renderers).
 */

import { detectCodeLanguage, languageDisplayLabel } from "../logic/language-detect";
import { PreviewKind } from "../types/preview-kind";
import type {
	PreviewInstance,
	PreviewModule,
	PreviewMountContext,
	PreviewSource,
} from "../types/preview-module";
import { decodeSource } from "./text-renderer";

export const codeRenderer: PreviewModule = {
	kind: PreviewKind.Code,
	async mount(context: PreviewMountContext): Promise<PreviewInstance> {
		return mountCode(context);
	},
	async extractMetadata(source) {
		const text = await decodeSource(source);
		const lang = detectCodeLanguage({ mime: source.mime, firstLine: firstLineOf(text) });
		return {
			language: languageDisplayLabel(lang),
			lines: String(linesOf(text).length),
			characters: String(text.length),
		};
	},
};

async function mountCode(context: PreviewMountContext): Promise<PreviewInstance> {
	const { host, source, file } = context;
	host.replaceChildren();

	const text = await decodeSource(source);
	const lines = linesOf(text);

	const stage = document.createElement("div");
	stage.className = "preview-stage preview-stage--code";

	// One horizontal+vertical scroll viewport; the gutter is sticky-left
	// so line numbers stay pinned while the code scrolls sideways.
	const viewport = document.createElement("div");
	viewport.className = "preview-code";

	const gutter = document.createElement("div");
	gutter.className = "preview-code__gutter";
	gutter.setAttribute("aria-hidden", "true");
	for (let i = 0; i < lines.length; i++) {
		const n = document.createElement("span");
		n.className = "preview-code__lineno";
		n.textContent = String(i + 1);
		gutter.appendChild(n);
	}

	const pre = document.createElement("pre");
	pre.className = "preview-code__body";
	const code = document.createElement("code");
	// Join the trimmed line list (not the raw text) so the body and the
	// gutter agree on line count exactly — a single source of truth.
	code.textContent = lines.join("\n");
	pre.appendChild(code);

	viewport.appendChild(gutter);
	viewport.appendChild(pre);
	stage.appendChild(viewport);
	host.appendChild(stage);

	// Detect once for the mounted view; the inspector re-derives via
	// extractMetadata (the host owns that pane). Kept consistent by both
	// going through `detectCodeLanguage`.
	void detectCodeLanguage({ path: file.name, mime: source.mime, firstLine: lines[0] ?? "" });

	return {
		dispose(): void {
			host.replaceChildren();
		},
	};
}

/** Split into display lines, dropping the phantom empty line a trailing
 *  newline would add (mirrors `text-renderer`'s line-count semantics so
 *  "lines" reads the same across both renderers). An empty file is one
 *  empty line so the gutter still shows `1`. */
export function linesOf(text: string): string[] {
	if (text.length === 0) return [""];
	const parts = text.split("\n");
	if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
	return parts;
}

function firstLineOf(text: string): string {
	const nl = text.indexOf("\n");
	return nl === -1 ? text : text.slice(0, nl);
}
