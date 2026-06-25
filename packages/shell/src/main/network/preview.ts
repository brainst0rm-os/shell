/**
 * Net-1a step 4 — link-preview extractor.
 *
 * Pure parser that turns raw HTML bytes (the first ~64 KiB of a page)
 * into a `LinkPreview` record. The fetching half lives in
 * `network-service-handler.ts`'s `preview` method, which reuses the
 * step-2 `executeNetworkFetch` with a 64 KiB size cap + a 5 s time
 * cap. This module never touches the network — it's a string→record
 * function so the unit suite can drive it with hand-built fixtures.
 *
 * Per `docs/security/38-network-and-proxy.md §Link previews`: the
 * extractor parses (in fall-through order)
 *
 *   1. OpenGraph tags (`<meta property="og:title">`, og:description,
 *      og:image, og:site_name, og:type, og:url)
 *   2. Twitter Card tags (`<meta name="twitter:title">`, etc.) — used
 *      to fill any field OG didn't.
 *   3. JSON-LD top-level objects (`<script type="application/ld+json">`)
 *      — `headline` / `description` / `image[0]` / `publisher.name`.
 *   4. Plain HTML fallbacks: `<title>`, `<meta name="description">`.
 *
 * The bytes never reach the renderer — the broker fetches, parses,
 * and returns a typed record. The image URL is returned as a string;
 * Net-1a step 5 (the Network panel) decides whether to deference it
 * (`?embed=blob` post-Net-1b) or surface as a plain URL.
 *
 * **Pure / side-effect-free**. The HTML parser is a regex-driven scan
 * — DOM construction would pull in a 200 KB dependency, and the
 * preview's value (a tiny structured record) doesn't need a full DOM.
 * The regex pass tolerates malformed HTML by ignoring unmatched
 * structure rather than throwing.
 */

export type LinkPreview = {
	/** The original URL the caller passed (post-SSRF, may be redirect-final). */
	readonly url: string;
	/** `og:url` canonical, if the page declared one — otherwise echoes `url`. */
	readonly canonicalUrl: string;
	/** First non-empty among: `og:title`, `twitter:title`, JSON-LD `headline`,
	 *  `<title>`, or the URL's hostname as last-resort. */
	readonly title: string;
	/** First non-empty among: `og:description`, `twitter:description`,
	 *  JSON-LD `description`, `<meta name="description">`. Empty string when
	 *  the page declared no description anywhere. */
	readonly description: string;
	/** `og:image`, then `twitter:image`, then JSON-LD `image[0]`. Empty when
	 *  none. Net-1b will resolve this to a `blob:` URL via the broker. */
	readonly image: string;
	/** Absolute favicon URL: the first `<link rel="…icon">` (standard before
	 *  `apple-touch-icon`), resolved against the page URL, falling back to the
	 *  origin's `/favicon.ico`. http(s) only — `javascript:`/`data:`/`file:`
	 *  hrefs are dropped (the renderer paints this straight into `<img src>`).
	 *  Empty only when the page URL itself is unparseable. */
	readonly favicon: string;
	/** `og:site_name`, then JSON-LD `publisher.name`, then the URL hostname. */
	readonly siteName: string;
	/** Offline-first local URL (`brainstorm://asset/<id>`) for the favicon,
	 *  set by the broker when it downloaded + encrypted the favicon bytes into
	 *  the vault asset store. Absent when no asset store is wired or the
	 *  sub-fetch failed — the consumer then has no offline icon (it never
	 *  paints the remote `favicon` URL). */
	readonly faviconAssetUrl?: string;
	/** Offline-first local URL for the OpenGraph cover image, same contract as
	 *  `faviconAssetUrl`. */
	readonly coverAssetUrl?: string;
	/** Best-effort content-kind label: `og:type` ("article", "video.movie",
	 *  …) or `"page"` as default. */
	readonly mediaType: string;
	/** Article author display name (9.18.6): JSON-LD `author.name`, then
	 *  `<meta name="author">`, then `article:author` — the OG field is often a
	 *  profile URL rather than a name, so a URL-shaped value is dropped (the
	 *  consumer renders this as a person's name). Absent when none found. */
	readonly author?: string;
	/** Epoch ms of the page's publish date (9.18.6): `article:published_time`,
	 *  then JSON-LD `datePublished`. Absent when the page declared none or the
	 *  value didn't parse as a date. */
	readonly publishedAt?: number;
	/** Wall-clock ms at extraction. The caller's cache layer keys off this. */
	readonly fetchedAt: number;
};

export type PreviewExtractInput = {
	/** Original URL. */
	readonly url: string;
	/** UTF-8 string the broker decoded from the response body. The decoder
	 *  is the caller's job — production decodes via `TextDecoder` with the
	 *  response's `Content-Type charset` parameter falling back to utf-8. */
	readonly html: string;
	/** Wall-clock ms when the response landed. */
	readonly fetchedAt?: number;
};

/**
 * Extract a `LinkPreview` from the input HTML. Returns a non-null record
 * even when the page has no meta tags — the fall-through stack lands
 * on the URL hostname as the title of last resort, so callers get a
 * useful card for any page that returned HTML.
 */
export function extractLinkPreview(input: PreviewExtractInput): LinkPreview {
	const html = input.html;
	const ogTags = readOpenGraph(html);
	const twitterTags = readTwitterCard(html);
	const ldJson = readJsonLd(html);
	const htmlTitle = readHtmlTitle(html);
	const metaDescription = readMetaDescription(html);
	const hostname = readUrlHostname(input.url);

	const title = firstNonEmpty([
		ogTags.title,
		twitterTags.title,
		ldJson.headline,
		htmlTitle,
		hostname,
	]);
	const description = firstNonEmpty([
		ogTags.description,
		twitterTags.description,
		ldJson.description,
		metaDescription,
		// Last resort: the page declared no description anywhere (Wikipedia
		// articles, many docs sites) — fall back to the first substantial body
		// paragraph so the card/detail isn't left blank.
		firstParagraphText(html),
	]);
	const image = firstNonEmpty([ogTags.image, twitterTags.image, ldJson.image]);
	const siteName = firstNonEmpty([ogTags.siteName, ldJson.publisherName, hostname]);
	const mediaType = firstNonEmpty([ogTags.type, "page"]);
	const canonicalUrl = firstNonEmpty([ogTags.url, input.url]);
	const favicon = readFavicon(html, input.url);
	const fetchedAt = input.fetchedAt ?? Date.now();
	// `article:author` is frequently a profile URL, not a display name — only a
	// non-URL value reads as a person's name (the citation row renders it raw).
	const author = firstNonEmpty([
		ldJson.authorName,
		readMetaAuthor(html),
		dropUrlShaped(ogTags.articleAuthor),
	]);
	const publishedAt = parsePublishedDate(
		firstNonEmpty([ogTags.publishedTime, ldJson.datePublished]),
	);

	return {
		url: input.url,
		canonicalUrl,
		title,
		description,
		image,
		favicon,
		siteName,
		mediaType,
		...(author.length > 0 ? { author } : {}),
		...(publishedAt !== null ? { publishedAt } : {}),
		fetchedAt,
	};
}

type OpenGraphTags = {
	title: string;
	description: string;
	image: string;
	siteName: string;
	type: string;
	url: string;
	articleAuthor: string;
	publishedTime: string;
};

function readOpenGraph(html: string): OpenGraphTags {
	return {
		title: metaContent(html, /property=["']og:title["']/i),
		description: metaContent(html, /property=["']og:description["']/i),
		image: metaContent(html, /property=["']og:image["']/i),
		siteName: metaContent(html, /property=["']og:site_name["']/i),
		type: metaContent(html, /property=["']og:type["']/i),
		url: metaContent(html, /property=["']og:url["']/i),
		articleAuthor: metaContent(html, /property=["']article:author["']/i),
		publishedTime: metaContent(html, /property=["']article:published_time["']/i),
	};
}

function readMetaAuthor(html: string): string {
	return metaContent(html, /name=["']author["']/i);
}

/** Collapse a value that parses as an absolute http(s)/other-scheme URL to ""
 *  — used where a display NAME is expected but pages supply a link. */
function dropUrlShaped(value: string): string {
	if (value.length === 0) return "";
	try {
		// `new URL` throws for non-absolute strings — a plain name passes through.
		new URL(value);
		return "";
	} catch {
		return value;
	}
}

/** Parse an ISO-8601-ish publish date to epoch ms, or null when absent /
 *  unparseable. */
function parsePublishedDate(value: string): number | null {
	if (value.length === 0) return null;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? ms : null;
}

type TwitterTags = {
	title: string;
	description: string;
	image: string;
};

function readTwitterCard(html: string): TwitterTags {
	return {
		title: metaContent(html, /name=["']twitter:title["']/i),
		description: metaContent(html, /name=["']twitter:description["']/i),
		image: metaContent(html, /name=["']twitter:image["']/i),
	};
}

/**
 * Find the first `<meta>` tag whose attributes match `propertyOrNameRe`
 * and return its `content` attribute value. Order of attributes within
 * the tag is allowed to vary (`<meta content="x" property="og:title">`
 * works the same as the reverse). Returns "" when not found.
 */
function metaContent(html: string, propertyOrNameRe: RegExp): string {
	// One pass over every `<meta ...>` tag, applying the predicate.
	const metaRe = /<meta\b[^>]*>/gi;
	for (const match of html.matchAll(metaRe)) {
		const tag = match[0];
		if (!propertyOrNameRe.test(tag)) continue;
		const contentMatch = tag.match(/content\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
		if (!contentMatch) continue;
		const value = (contentMatch[1] ?? contentMatch[2] ?? "").trim();
		if (value.length > 0) return decodeHtmlEntities(value);
	}
	return "";
}

function readHtmlTitle(html: string): string {
	const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	if (!m || m[1] === undefined) return "";
	return decodeHtmlEntities(m[1].trim());
}

function readMetaDescription(html: string): string {
	return metaContent(html, /name=["']description["']/i);
}

/** Fallback description: the first `<p>` with enough visible text to read as a
 *  lead paragraph. Tags are stripped, entities decoded, whitespace collapsed;
 *  short paragraphs (empty placeholders, captions, "Jump to navigation") are
 *  skipped via the length floor, and the result is capped so a card blurb
 *  stays a blurb. Best-effort + regex-based — the readable extractor (Net-2)
 *  does the high-quality job; this just keeps the preview from being blank. */
const FALLBACK_PARAGRAPH_MIN_CHARS = 80;
const FALLBACK_PARAGRAPH_MAX_CHARS = 300;

function firstParagraphText(html: string): string {
	const paraRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
	for (const match of html.matchAll(paraRe)) {
		const inner = match[1];
		if (inner === undefined) continue;
		const text = decodeHtmlEntities(
			inner
				.replace(/<[^>]+>/g, " ")
				.replace(/\s+/g, " ")
				.trim(),
		);
		if (text.length < FALLBACK_PARAGRAPH_MIN_CHARS) continue;
		return text.length > FALLBACK_PARAGRAPH_MAX_CHARS
			? `${text.slice(0, FALLBACK_PARAGRAPH_MAX_CHARS).trimEnd()}…`
			: text;
	}
	return "";
}

type JsonLdTags = {
	headline: string;
	description: string;
	image: string;
	publisherName: string;
	authorName: string;
	datePublished: string;
};

/** JSON-LD `author` is a Person/Organization object, an array of them, or a
 *  bare string — pull the first usable display name. */
function jsonLdAuthorName(author: unknown): string {
	const candidates = Array.isArray(author) ? author : [author];
	for (const c of candidates) {
		if (typeof c === "string" && c.length > 0) return c;
		if (c && typeof c === "object") {
			const name = (c as Record<string, unknown>).name;
			if (typeof name === "string" && name.length > 0) return name;
		}
	}
	return "";
}

function readJsonLd(html: string): JsonLdTags {
	const out: JsonLdTags = {
		headline: "",
		description: "",
		image: "",
		publisherName: "",
		authorName: "",
		datePublished: "",
	};
	const scriptRe =
		/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
	for (const match of html.matchAll(scriptRe)) {
		const body = match[1];
		if (body === undefined) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(body);
		} catch {
			continue;
		}
		const arr = Array.isArray(parsed) ? parsed : [parsed];
		for (const candidate of arr) {
			if (!candidate || typeof candidate !== "object") continue;
			const c = candidate as Record<string, unknown>;
			if (out.headline.length === 0 && typeof c.headline === "string") out.headline = c.headline;
			if (out.headline.length === 0 && typeof c.name === "string") out.headline = c.name;
			if (out.description.length === 0 && typeof c.description === "string")
				out.description = c.description;
			if (out.image.length === 0) {
				if (typeof c.image === "string") out.image = c.image;
				else if (Array.isArray(c.image) && typeof c.image[0] === "string") out.image = c.image[0];
				else if (
					c.image &&
					typeof c.image === "object" &&
					typeof (c.image as Record<string, unknown>).url === "string"
				) {
					out.image = (c.image as Record<string, unknown>).url as string;
				}
			}
			if (
				out.publisherName.length === 0 &&
				c.publisher &&
				typeof c.publisher === "object" &&
				typeof (c.publisher as Record<string, unknown>).name === "string"
			) {
				out.publisherName = (c.publisher as Record<string, unknown>).name as string;
			}
			if (out.authorName.length === 0) out.authorName = jsonLdAuthorName(c.author);
			if (out.datePublished.length === 0 && typeof c.datePublished === "string") {
				out.datePublished = c.datePublished;
			}
		}
	}
	return out;
}

/**
 * Resolve the page's favicon to an absolute http(s) URL. Scans every
 * `<link rel="…icon">` (the `rel` token may be `icon` / `shortcut icon` /
 * `apple-touch-icon` / `mask-icon`), resolving each `href` against the page
 * URL. Standard `icon`/`shortcut icon` win over `apple-touch-icon`; when the
 * page declares none, falls back to the origin's `/favicon.ico`. Only http(s)
 * survives — a `javascript:` / `data:` / `file:` href is dropped so the value
 * is always safe to drop into `<img src>`.
 */
function readFavicon(html: string, pageUrl: string): string {
	let standard = "";
	let appleTouch = "";
	for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
		const tag = match[0];
		const relMatch = tag.match(/\brel\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
		const rel = (relMatch?.[1] ?? relMatch?.[2] ?? "").toLowerCase();
		if (!/\bicon\b/.test(rel)) continue;
		const hrefMatch = tag.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
		const href = decodeHtmlEntities((hrefMatch?.[1] ?? hrefMatch?.[2] ?? "").trim());
		const resolved = resolveHttpUrl(href, pageUrl);
		if (resolved.length === 0) continue;
		if (rel.includes("apple-touch-icon")) {
			if (appleTouch.length === 0) appleTouch = resolved;
		} else if (standard.length === 0) {
			standard = resolved;
		}
	}
	if (standard.length > 0) return standard;
	if (appleTouch.length > 0) return appleTouch;
	return resolveHttpUrl("/favicon.ico", pageUrl);
}

/** Resolve `href` against `base`, returning the absolute URL only when it is
 *  http(s). Anything else (relative-resolve failure, `javascript:`, `data:`,
 *  `file:`, `mailto:`) collapses to "". */
function resolveHttpUrl(href: string, base: string): string {
	if (href.length === 0) return "";
	try {
		const u = new URL(href, base);
		return u.protocol === "http:" || u.protocol === "https:" ? u.href : "";
	} catch {
		return "";
	}
}

function readUrlHostname(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return "";
	}
}

function firstNonEmpty(candidates: readonly string[]): string {
	for (const c of candidates) {
		if (c.length > 0) return c;
	}
	return "";
}

/**
 * Decode the small set of HTML entities that show up in OG/meta values:
 * `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`, `&#NN;`, `&#xHH;`. Pages
 * sometimes encode these in `content="..."` even though attribute values
 * don't strictly require it, so the decoder fires defensively.
 */
function decodeHtmlEntities(text: string): string {
	return text
		.replace(/&(amp|lt|gt|quot|apos);/gi, (_full, entity) => {
			switch ((entity as string).toLowerCase()) {
				case "amp":
					return "&";
				case "lt":
					return "<";
				case "gt":
					return ">";
				case "quot":
					return '"';
				case "apos":
					return "'";
				default:
					return _full;
			}
		})
		.replace(/&#(\d+);/g, (_full, code) => {
			const n = Number(code);
			if (!Number.isInteger(n) || n < 0 || n > 0x10ffff) return _full;
			return String.fromCodePoint(n);
		})
		.replace(/&#x([0-9a-f]+);/gi, (_full, code) => {
			const n = Number.parseInt(code, 16);
			if (!Number.isInteger(n) || n < 0 || n > 0x10ffff) return _full;
			return String.fromCodePoint(n);
		});
}
