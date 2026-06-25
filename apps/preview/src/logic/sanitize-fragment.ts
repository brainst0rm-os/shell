/**
 * Allowlist HTML sanitizer — 9.20.9 (DOCX rendering).
 *
 * mammoth converts a `.docx` into an HTML string. The rest of Preview is
 * XSS-safe-by-construction (text nodes only, no `innerHTML`), so to keep
 * that posture we never inject mammoth's string. Instead we parse it in an
 * INERT document (`DOMParser` — scripts don't run, resources don't load)
 * and rebuild a fresh `DocumentFragment` containing only allowlisted tags
 * and attributes. Everything else is either dropped wholesale (script /
 * style / iframe …) or unwrapped to its text (unknown tags). The result is
 * structurally bounded and carries zero attacker-controlled markup.
 */

const ALLOWED_TAGS = new Set([
	"p",
	"br",
	"hr",
	"div",
	"span",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"strong",
	"b",
	"em",
	"i",
	"u",
	"s",
	"sup",
	"sub",
	"small",
	"ul",
	"ol",
	"li",
	"blockquote",
	"pre",
	"code",
	"a",
	"img",
	"table",
	"thead",
	"tbody",
	"tfoot",
	"tr",
	"td",
	"th",
	"caption",
]);

/** Dropped with all descendants — their content must never surface. */
const DROP_WITH_CONTENT = new Set([
	"script",
	"style",
	"head",
	"title",
	"noscript",
	"iframe",
	"object",
	"embed",
	"template",
	"link",
	"meta",
]);

function isSafeHref(value: string): boolean {
	const v = value.trim().toLowerCase();
	// Relative / anchor links are safe; otherwise only http(s)/mailto.
	if (v.startsWith("#") || v.startsWith("/")) return true;
	return /^(https?:|mailto:)/.test(v);
}

function clampSpan(value: string): string | null {
	const n = Number.parseInt(value, 10);
	if (!Number.isFinite(n) || n < 1) return null;
	return String(Math.min(n, 1000));
}

/** Copy only the attributes that are allowed for `tag`, validating URLs. */
function copyAttributes(from: Element, to: Element, tag: string): void {
	if (tag === "a") {
		const href = from.getAttribute("href");
		if (href && isSafeHref(href)) {
			to.setAttribute("href", href);
			to.setAttribute("rel", "noopener noreferrer");
		}
	} else if (tag === "img") {
		const src = from.getAttribute("src");
		// Only embedded data: images — remote URLs are an IP-leak + CSP risk.
		if (src?.trim().toLowerCase().startsWith("data:image/")) to.setAttribute("src", src);
		const alt = from.getAttribute("alt");
		if (alt) to.setAttribute("alt", alt);
	} else if (tag === "td" || tag === "th") {
		for (const name of ["colspan", "rowspan"]) {
			const raw = from.getAttribute(name);
			const span = raw ? clampSpan(raw) : null;
			if (span) to.setAttribute(name, span);
		}
	}
}

function sanitizeInto(source: Node, target: Node, doc: Document, depth: number): void {
	// Bound recursion so a pathologically deep tree can't blow the stack.
	if (depth > 256) return;
	for (const child of Array.from(source.childNodes)) {
		if (child.nodeType === 3 /* text */) {
			target.appendChild(doc.createTextNode(child.nodeValue ?? ""));
			continue;
		}
		if (child.nodeType !== 1 /* element */) continue; // comments, PIs → drop
		const el = child as Element;
		const tag = el.tagName.toLowerCase();
		if (DROP_WITH_CONTENT.has(tag)) continue;
		if (!ALLOWED_TAGS.has(tag)) {
			// Unknown-but-harmless wrapper: keep its text content, drop the tag.
			sanitizeInto(el, target, doc, depth + 1);
			continue;
		}
		const fresh = doc.createElement(tag);
		copyAttributes(el, fresh, tag);
		sanitizeInto(el, fresh, doc, depth + 1);
		target.appendChild(fresh);
	}
}

/** Parse `html` inertly and return a fresh fragment of allowlisted nodes
 *  owned by `doc`. Safe to append into the live document. */
export function sanitizeToFragment(html: string, doc: Document): DocumentFragment {
	const fragment = doc.createDocumentFragment();
	const parsed = new DOMParser().parseFromString(html, "text/html");
	sanitizeInto(parsed.body, fragment, doc, 0);
	return fragment;
}
