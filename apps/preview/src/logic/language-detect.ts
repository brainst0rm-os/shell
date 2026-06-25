/**
 * Language detection for the read-only code renderer. The detector lives in
 * `@brainstorm/sdk/language-detect` (shared with the Code Editor app); this
 * module re-exports the enum + label and names the preview's
 * `PlainText`-fallback resolver (`detectCodeLanguage`) — the preview always
 * shows the file in a monospace gutter, so it never reports "unknown".
 */

import { CodeLanguage, detectLanguage } from "@brainstorm/sdk/language-detect";

export { CodeLanguage, languageDisplayLabel } from "@brainstorm/sdk/language-detect";

/**
 * Best-guess language; `PlainText` when every signal is empty or
 * unrecognised (the renderer still shows the file).
 */
export function detectCodeLanguage(input: {
	path?: string;
	mime?: string;
	firstLine?: string;
}): CodeLanguage {
	return detectLanguage(input, { fallback: CodeLanguage.PlainText });
}
