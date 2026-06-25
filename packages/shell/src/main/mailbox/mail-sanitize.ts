/**
 * `sanitizeMailHtml` — turn a raw inbound HTML body into `bodyHtmlSafe`
 * (doc 53 §Email/v1: HTML is stored already-sanitised; hostile HTML mail is
 * the same threat class as a hostile embed, doc 38).
 *
 * Built on the same trusted **DOM-parser** sanitizer the readable-extraction
 * pipeline uses (`sanitize-html`, see `network/readable/sanitize-html.ts`) —
 * NOT a regex pass. A regex element/attribute stripper is defeated by
 * malformed tags, `>` inside quoted attributes, unquoted attribute values, and
 * mXSS re-tokenisation; the parser resists all of those by construction, so
 * there is one audited HTML-sanitiser idiom in the codebase, not two.
 *
 * This is **layer 1** of two. Layer 2 is the viewer's `sandbox`ed iframe with
 * its own `default-src 'none'` CSP and no `allow-scripts` (apps/mailbox
 * `remote-content.ts`) — the *enforced* boundary, so even a bypass here cannot
 * execute. Storing sanitised HTML still matters: Search/AI/Graph read
 * `bodyHtmlSafe` raw (no iframe), so the persisted string must already be safe.
 *
 * Allowlist choices vs. the readable sanitizer: mail keeps a **richer** tag set
 * (tables, inline formatting, `font`/`div`/`span`) and the `style`/layout
 * attributes mail relies on — inline CSS is left intact because the viewer's
 * frame CSP (`default-src 'none'`) neutralises any active CSS (`url()` loads,
 * etc.) and the raw consumers never execute CSS. Remote `http(s)` image `src`
 * is **preserved** (the viewer blocks-then-one-click-shows it); `data:` and
 * protocol-relative URLs are dropped (a `data:image/svg+xml` can carry script;
 * a `//host` URL is an un-vetted remote fetch).
 */

import sanitizeHtml from "sanitize-html";

/** Tags mail rendering needs — structure + inline formatting + media +
 *  tables. Anything else (incl. the active/embedding tags in `nonTextTags`
 *  below) is discarded. */
export const MAIL_ALLOWED_TAGS: readonly string[] = [
	"p",
	"div",
	"span",
	"br",
	"hr",
	"blockquote",
	"pre",
	"code",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"ul",
	"ol",
	"li",
	"dl",
	"dt",
	"dd",
	"a",
	"b",
	"i",
	"u",
	"em",
	"strong",
	"s",
	"strike",
	"del",
	"ins",
	"sub",
	"sup",
	"small",
	"mark",
	"font",
	"center",
	"abbr",
	"cite",
	"q",
	"wbr",
	"img",
	"figure",
	"figcaption",
	"table",
	"thead",
	"tbody",
	"tfoot",
	"tr",
	"th",
	"td",
	"caption",
	"col",
	"colgroup",
];

/** Layout/style attributes mail bodies carry on most tags. Notably includes
 *  `style` (inline CSS — see header rationale); never includes `on*` (event
 *  handlers are dropped because they are outside this allowlist). */
const GLOBAL_ATTRS: readonly string[] = [
	"style",
	"class",
	"align",
	"dir",
	"title",
	"width",
	"height",
	"bgcolor",
	"valign",
];

const MAIL_ALLOWED_ATTRIBUTES: Record<string, readonly string[]> = {
	"*": GLOBAL_ATTRS,
	a: ["href", "name", "target", "rel", ...GLOBAL_ATTRS],
	img: ["src", "alt", ...GLOBAL_ATTRS],
	font: ["color", "face", "size", ...GLOBAL_ATTRS],
	table: ["cellpadding", "cellspacing", "border", "summary", ...GLOBAL_ATTRS],
	td: ["colspan", "rowspan", ...GLOBAL_ATTRS],
	th: ["colspan", "rowspan", "scope", ...GLOBAL_ATTRS],
	col: ["span", ...GLOBAL_ATTRS],
	colgroup: ["span", ...GLOBAL_ATTRS],
};

/** Schemes permitted on `href`/`src`. No `data:` (a `data:image/svg+xml`
 *  carries script; `data:text/html` hosts markup) and no protocol-relative. */
const MAIL_ALLOWED_SCHEMES: readonly string[] = [
	"http",
	"https",
	"mailto",
	"tel",
	"cid",
	"brainstorm",
];

/** Tags whose **content** is dropped with the tag — active / embedding /
 *  form / metadata elements must not leak script payloads as visible prose. */
const MAIL_NON_TEXT_TAGS: readonly string[] = [
	"script",
	"style",
	"iframe",
	"object",
	"embed",
	"applet",
	"frame",
	"frameset",
	"form",
	"input",
	"button",
	"textarea",
	"select",
	"link",
	"meta",
	"base",
	"title",
	"head",
	"noscript",
	"svg",
	"math",
];

export function sanitizeMailHtml(rawHtml: string): string {
	if (typeof rawHtml !== "string" || rawHtml.length === 0) return "";
	return sanitizeHtml(rawHtml, {
		allowedTags: [...MAIL_ALLOWED_TAGS],
		allowedAttributes: Object.fromEntries(
			Object.entries(MAIL_ALLOWED_ATTRIBUTES).map(([tag, attrs]) => [tag, [...attrs]]),
		),
		allowedSchemes: [...MAIL_ALLOWED_SCHEMES],
		allowProtocolRelative: false,
		disallowedTagsMode: "discard",
		nonTextTags: [...MAIL_NON_TEXT_TAGS],
		allowedSchemesAppliedToAttributes: ["href", "src"],
		// Force every surviving link to be reverse-tabnabbing-safe + referrer-
		// quiet. Defense-in-depth: the viewer frame has no `allow-scripts` so a
		// popup can't script `window.opener`, but a click still leaks the
		// Referer and opens a real top-level context — `noopener`/`noreferrer`
		// close both. `merge: true` keeps the link's own `href`/`target`.
		transformTags: {
			a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer nofollow" }, true),
		},
		parser: { lowerCaseTags: true, lowerCaseAttributeNames: true },
	}).trim();
}
