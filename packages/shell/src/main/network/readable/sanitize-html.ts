/**
 * Readable-extraction sanitizer (Net-2a) — the **security boundary** of the
 * readable-content pipeline (doc 58 §The extraction core). Pure
 * `string → string`: takes the article HTML that Readability isolated and
 * returns a strictly-allowlisted subset.
 *
 * **Allowlist, never denylist.** The permitted tag set is *exactly* the set the
 * HTML→Lexical block importer maps 1:1 (`html-to-blocks.ts`); anything outside
 * it is discarded. Because the sanitized output is then *converted to Lexical
 * blocks* (not injected as DOM), the block importer — which only emits known
 * node types — is a second structural backstop, so a sanitizer miss can never
 * become live DOM. This module is still the first line and is fuzzed
 * adversarially (its tests + the Net-2e `/pentester` pass).
 *
 * Dropped unconditionally: `<script>/<style>/<iframe>/<object>/<embed>/<base>/`
 * `<noscript>/<textarea>` (tag **and** their text content), every `style`
 * attribute, every `on*` handler, every attribute outside the per-tag
 * allowlist, and every `javascript:` / `data:` / `vbscript:` / `file:` /
 * protocol-relative URL.
 */

import sanitizeHtml from "sanitize-html";

/** The 1:1 importable tag set — keep in lockstep with `html-to-blocks.ts`. */
export const READABLE_ALLOWED_TAGS: readonly string[] = [
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"p",
	"ul",
	"ol",
	"li",
	"blockquote",
	"pre",
	"code",
	"em",
	"strong",
	"br",
	"hr",
	"a",
	"img",
	"table",
	"thead",
	"tbody",
	"tr",
	"th",
	"td",
];

/** Per-tag attribute allowlist. Nothing else survives — notably no `style`,
 *  no `on*`, no `srcset`, no `id`. */
const READABLE_ALLOWED_ATTRIBUTES: Record<string, readonly string[]> = {
	a: ["href", "title"],
	img: ["src", "alt", "title", "width", "height"],
	code: ["class"],
	pre: ["class"],
	table: ["summary"],
};

/** URL schemes permitted on `href` / `src`. `javascript:` / `data:` /
 *  `vbscript:` / `file:` are absent → dropped; protocol-relative `//host` is
 *  rejected separately. Relative + anchor (`#…`) URLs carry no scheme and pass
 *  (Readability has already absolutised them against the page's base URL). */
const READABLE_ALLOWED_SCHEMES: readonly string[] = ["http", "https", "mailto", "brainstorm"];

/** Tags whose **content** is dropped along with the tag (not flattened to
 *  text) — script/style payloads must not leak as visible prose. */
const READABLE_NON_TEXT_TAGS: readonly string[] = [
	"script",
	"style",
	"iframe",
	"object",
	"embed",
	"base",
	"noscript",
	"textarea",
];

export function sanitizeReadableHtml(html: string): string {
	return sanitizeHtml(html, {
		allowedTags: [...READABLE_ALLOWED_TAGS],
		allowedAttributes: Object.fromEntries(
			Object.entries(READABLE_ALLOWED_ATTRIBUTES).map(([tag, attrs]) => [tag, [...attrs]]),
		),
		allowedSchemes: [...READABLE_ALLOWED_SCHEMES],
		allowProtocolRelative: false,
		disallowedTagsMode: "discard",
		nonTextTags: [...READABLE_NON_TEXT_TAGS],
		// Belt-and-braces: never let a stray comment carry markup through.
		allowedSchemesAppliedToAttributes: ["href", "src"],
		parser: { lowerCaseTags: true, lowerCaseAttributeNames: true },
	});
}
