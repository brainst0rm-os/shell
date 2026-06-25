/**
 * Readable-article isolation (Net-2a) — runs Mozilla **Readability** over a DOM
 * built **without a script engine** (`linkedom`) to strip nav / aside / header /
 * footer / comment / share-bar chrome and leave the main article column.
 *
 * Pure + deterministic: `html` in → fixed `ReadableResult` (or `null` when the
 * page has no extractable article — a JS-only shell, a login wall, a thin
 * landing page). The caller decides the fallback (metadata-only). The returned
 * `html` is Readability's article content, **still unsanitized** — it must pass
 * through `sanitizeReadableHtml` before it is shown or converted to blocks.
 *
 * No network, no JS execution, no DOM globals — safe to run anywhere (the
 * production locus is the extraction utility worker, Net-2b; the function
 * itself is runtime-agnostic so it tests in-process).
 */

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export type ReadableMeta = {
	title: string | null;
	byline: string | null;
	siteName: string | null;
	excerpt: string | null;
	lang: string | null;
	publishedAt: string | null;
};

export type ReadableResult = {
	meta: ReadableMeta;
	/** Readability's isolated article HTML — UNSANITIZED. Sanitize before use. */
	html: string;
	/** Flattened text (for indexing / excerpting / the body-size cap). */
	textContent: string;
	/** Readability's char count of the article. */
	length: number;
};

/** Inject a `<base href>` so Readability's relative→absolute URL fix resolves
 *  against the real page URL (linkedom's document has no intrinsic base). */
function withBaseHref(html: string, baseUrl: string): string {
	const tag = `<base href="${baseUrl.replace(/"/g, "&quot;")}">`;
	if (/<head[\s>]/i.test(html)) return html.replace(/<head([\s>])/i, `<head$1${tag}`);
	if (/<html[\s>]/i.test(html)) return html.replace(/<html([^>]*)>/i, `<html$1><head>${tag}</head>`);
	return `<head>${tag}</head>${html}`;
}

/** Minimum trustworthy text length for a semantic container — below this the
 *  `<article>`/`<main>` is likely a teaser/card, so we fall back to full-page
 *  Readability rather than extract a thin stub. */
const SEMANTIC_MIN_TEXT = 200;

/**
 * Semantic-first: prefer a prominent `<article>` (the largest by text when a
 * page has several, e.g. a feed) and then `<main>`. Returns that container's
 * `outerHTML` so Readability can clean *within* the author-declared content
 * region — which beats whole-page heuristics on well-structured pages — or
 * null when there's no substantial semantic container.
 */
function semanticRootHtml(doc: Document): string | null {
	let best: Element | null = null;
	let bestLen = 0;
	for (const el of Array.from(doc.querySelectorAll("article"))) {
		const len = (el.textContent ?? "").trim().length;
		if (len > bestLen) {
			best = el;
			bestLen = len;
		}
	}
	if (!best) best = doc.querySelector("main");
	if (!best) return null;
	if ((best.textContent ?? "").trim().length < SEMANTIC_MIN_TEXT) return null;
	return best.outerHTML ?? null;
}

/** Run Readability over an already-parsed doc → `ReadableResult` or null. */
function readabilityOf(doc: Document): ReadableResult | null {
	let article: ReturnType<Readability["parse"]>;
	try {
		// Readability mutates `doc` in place; that's fine — `doc` is our throwaway
		// linkedom parse, never the caller's.
		article = new Readability(doc).parse();
	} catch {
		return null;
	}
	if (article === null || typeof article.content !== "string" || article.content.length === 0) {
		return null;
	}
	return {
		meta: {
			title: article.title ?? null,
			byline: article.byline ?? null,
			siteName: article.siteName ?? null,
			excerpt: article.excerpt ?? null,
			lang: article.lang ?? null,
			publishedAt: article.publishedTime ?? null,
		},
		html: article.content,
		textContent: article.textContent ?? "",
		length: article.length ?? 0,
	};
}

function parse(html: string, baseUrl: string): Document | null {
	try {
		return parseHTML(withBaseHref(html, baseUrl)).document as unknown as Document;
	} catch {
		return null;
	}
}

export function extractReadable(html: string, baseUrl: string): ReadableResult | null {
	if (typeof html !== "string" || html.trim().length === 0) return null;

	const probe = parse(html, baseUrl);
	if (!probe) return null;

	// Try the author's semantic container first; only fall back to whole-page
	// heuristics when there isn't a substantial one (or it extracts to nothing).
	// Carry the original <head> into the scoped doc so Readability still reads
	// the page's title / lang / og:site_name metadata (they live in <head>,
	// not the <article>).
	const semantic = semanticRootHtml(probe);
	if (semantic !== null) {
		const headInner = probe.querySelector("head")?.innerHTML ?? "";
		const lang = probe.documentElement?.getAttribute("lang");
		const langAttr = lang ? ` lang="${lang.replace(/"/g, "&quot;")}"` : "";
		const scopedDoc = parse(
			`<html${langAttr}><head>${headInner}</head><body>${semantic}</body></html>`,
			baseUrl,
		);
		const scoped = scopedDoc ? readabilityOf(scopedDoc) : null;
		if (scoped !== null) return scoped;
	}

	// Full-page fallback — reuse the probe doc (Readability mutates it, but the
	// semantic outerHTML above was already snapshotted as a string).
	return readabilityOf(probe);
}
