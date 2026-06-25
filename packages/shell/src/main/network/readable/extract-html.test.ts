import { describe, expect, it } from "vitest";
import { extractReadable } from "./extract-html";

const article = (body: string, head = "") =>
	`<!doctype html><html lang="en"><head><title>Doc Title</title>${head}</head><body>${body}</body></html>`;

// Readability needs a substantive main column to score; pad with real prose.
const PROSE =
	"<p>The quick brown fox jumps over the lazy dog. Readability scores paragraphs by the density of text versus link markup, so the article body needs a few sentences of genuine prose to win over the surrounding chrome and be selected as the main column.</p>".repeat(
		4,
	);

describe("extractReadable", () => {
	it("isolates the article and strips nav/aside/footer chrome", () => {
		const html = article(
			`<nav>Home About Contact</nav><aside>Related posts and ads</aside>
			 <article><h1>Real Heading</h1>${PROSE}</article>
			 <footer>Cookie banner · newsletter signup</footer>`,
		);
		const result = extractReadable(html, "https://example.test/post");
		expect(result).not.toBeNull();
		expect(result?.html).toContain("Real Heading");
		expect(result?.textContent).toContain("quick brown fox");
		// Chrome stripped.
		expect(result?.textContent).not.toContain("Cookie banner");
		expect(result?.textContent).not.toContain("Related posts");
		expect(result?.length).toBeGreaterThan(0);
	});

	it("prefers the largest <article> when a page has several (feed layout)", () => {
		const teaser = "<article><h2>Teaser</h2><p>Short blurb.</p></article>";
		const main = `<article><h1>Main Story</h1>${PROSE}</article>`;
		const html = article(`<nav>menu</nav>${teaser}${main}${teaser}`);
		const result = extractReadable(html, "https://example.test/feed");
		expect(result?.textContent).toContain("quick brown fox");
		expect(result?.html).toContain("Main Story");
	});

	it("falls back to <main> when there's no <article>", () => {
		const html = article(
			`<nav>menu</nav><main><h1>Main Region</h1>${PROSE}</main><footer>junk</footer>`,
		);
		const result = extractReadable(html, "https://example.test/page");
		expect(result?.html).toContain("Main Region");
		expect(result?.textContent).toContain("quick brown fox");
		expect(result?.textContent).not.toContain("junk");
	});

	it("captures metadata (title, lang, byline, site name)", () => {
		const html = article(
			`<article><h1>Title</h1><p class="byline">By Jane Doe</p>${PROSE}</article>`,
			'<meta property="og:site_name" content="Example Site"><meta name="author" content="Jane Doe">',
		);
		const result = extractReadable(html, "https://example.test/post");
		expect(result?.meta.title).toBeTruthy();
		expect(result?.meta.lang).toBe("en");
		expect(result?.meta.siteName).toBe("Example Site");
		expect(result?.meta.byline).toContain("Jane Doe");
	});

	it("returns null for an empty / whitespace document", () => {
		expect(extractReadable("", "https://x.test")).toBeNull();
		expect(extractReadable("   \n  ", "https://x.test")).toBeNull();
	});

	it("returns null for a JS-only shell with no article body", () => {
		const html = article('<div id="root"></div>');
		expect(extractReadable(html, "https://spa.test")).toBeNull();
	});

	it("absolutises relative links against the base URL", () => {
		const html = article(
			`<article><h1>Links</h1>${PROSE}<p><a href="/rel/page">relative link with enough surrounding prose to keep the paragraph</a></p></article>`,
		);
		const result = extractReadable(html, "https://example.test/dir/");
		// Readability's _fixRelativeUris resolves against the injected <base>.
		expect(result?.html).toContain("https://example.test/rel/page");
	});
});
