import { describe, expect, it } from "vitest";
import { extractLinkPreview } from "./preview";

const URL = "https://example.com/article";

describe("extractLinkPreview — OpenGraph", () => {
	it("reads og:title / og:description / og:image / og:site_name / og:type / og:url", () => {
		const html = `
			<html><head>
				<meta property="og:title" content="The Title">
				<meta property="og:description" content="A short description.">
				<meta property="og:image" content="https://example.com/og.png">
				<meta property="og:site_name" content="Example News">
				<meta property="og:type" content="article">
				<meta property="og:url" content="https://example.com/canonical">
			</head></html>
		`;
		const p = extractLinkPreview({ url: URL, html, fetchedAt: 1_000 });
		expect(p.title).toBe("The Title");
		expect(p.description).toBe("A short description.");
		expect(p.image).toBe("https://example.com/og.png");
		expect(p.siteName).toBe("Example News");
		expect(p.mediaType).toBe("article");
		expect(p.canonicalUrl).toBe("https://example.com/canonical");
		expect(p.fetchedAt).toBe(1_000);
		expect(p.url).toBe(URL);
	});

	it("tolerates attribute-order variation (content before property)", () => {
		const html = `<meta content="reverse-order" property="og:title">`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.title).toBe("reverse-order");
	});

	it("tolerates single-quoted attributes", () => {
		const html = `<meta property='og:title' content='single'>`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.title).toBe("single");
	});

	it("decodes HTML entities in OG content", () => {
		const html = `<meta property="og:title" content="A &amp; B &lt;c&gt; &quot;d&quot;">`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.title).toBe('A & B <c> "d"');
	});

	it("decodes numeric and hex character refs", () => {
		const html = `<meta property="og:title" content="&#9731; snowman &#x2603;">`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.title).toBe("☃ snowman ☃");
	});
});

describe("extractLinkPreview — Twitter Card fallback", () => {
	it("uses twitter:title when og:title is missing", () => {
		const html = `<meta name="twitter:title" content="From Twitter">`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.title).toBe("From Twitter");
	});

	it("uses twitter:description / twitter:image when OG missing", () => {
		const html = `
			<meta name="twitter:description" content="t-desc">
			<meta name="twitter:image" content="https://example.com/t.png">
		`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.description).toBe("t-desc");
		expect(p.image).toBe("https://example.com/t.png");
	});

	it("og:title wins over twitter:title", () => {
		const html = `
			<meta property="og:title" content="OG wins">
			<meta name="twitter:title" content="Twitter loses">
		`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.title).toBe("OG wins");
	});
});

describe("extractLinkPreview — first-paragraph description fallback", () => {
	it("falls back to the first substantial <p> when no meta description exists", () => {
		// Wikipedia-shaped: no og/twitter/JSON-LD/meta description, but a lead
		// paragraph in the body.
		const html = `
			<html><head><title>Pope Leo XIV - Wikipedia</title></head><body>
				<p class="mw-empty-elt"></p>
				<p><b>Pope Leo XIV</b> is the head of the Catholic Church and a notable historical figure described at length on this encyclopedia page.</p>
			</body></html>
		`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.description).toContain("Pope Leo XIV is the head of the Catholic Church");
		// Inner tags are stripped, not included verbatim.
		expect(p.description).not.toContain("<b>");
	});

	it("prefers a real meta description over the paragraph fallback", () => {
		const html = `
			<head><meta name="description" content="The real description."></head>
			<body><p>A long lead paragraph that should be ignored because a meta description is present and wins the fallback chain.</p></body>
		`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.description).toBe("The real description.");
	});

	it("skips short paragraphs (captions / placeholders) and yields empty when none qualify", () => {
		const html = "<body><p>Jump to navigation</p><p>Edit</p></body>";
		const p = extractLinkPreview({ url: URL, html });
		expect(p.description).toBe("");
	});

	it("caps an overlong paragraph with an ellipsis", () => {
		const long = `${"word ".repeat(120).trim()}.`;
		const html = `<body><p>${long}</p></body>`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.description.length).toBeLessThanOrEqual(301);
		expect(p.description.endsWith("…")).toBe(true);
	});
});

describe("extractLinkPreview — JSON-LD fallback", () => {
	it("extracts headline / description / image / publisher.name", () => {
		const html = `
			<script type="application/ld+json">
			{
				"@type": "NewsArticle",
				"headline": "JSON-LD Headline",
				"description": "JSON-LD desc",
				"image": ["https://example.com/ld.png", "https://example.com/ld2.png"],
				"publisher": { "@type": "Organization", "name": "JSON-LD Publisher" }
			}
			</script>
		`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.title).toBe("JSON-LD Headline");
		expect(p.description).toBe("JSON-LD desc");
		expect(p.image).toBe("https://example.com/ld.png");
		expect(p.siteName).toBe("JSON-LD Publisher");
	});

	it("accepts string image (not array)", () => {
		const html = `
			<script type="application/ld+json">
			{"@type":"Article","image":"https://example.com/single.png","headline":"x"}
			</script>
		`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.image).toBe("https://example.com/single.png");
	});

	it("accepts image as nested {url}", () => {
		const html = `
			<script type="application/ld+json">
			{"@type":"Article","image":{"url":"https://example.com/nested.png","width":1200},"headline":"x"}
			</script>
		`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.image).toBe("https://example.com/nested.png");
	});

	it("tolerates malformed JSON-LD without throwing", () => {
		const html = `
			<script type="application/ld+json">
			this is { not json }}}
			</script>
			<meta property="og:title" content="OG still works">
		`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.title).toBe("OG still works");
	});

	it("accepts an array of JSON-LD objects (multi-schema page)", () => {
		const html = `
			<script type="application/ld+json">
			[
				{"@type":"BreadcrumbList"},
				{"@type":"Article","headline":"From array entry"}
			]
			</script>
		`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.title).toBe("From array entry");
	});
});

describe("extractLinkPreview — plain-HTML fallbacks", () => {
	it("uses <title> when no meta tags exist", () => {
		const html = "<html><head><title>Plain Title</title></head></html>";
		const p = extractLinkPreview({ url: URL, html });
		expect(p.title).toBe("Plain Title");
	});

	it("uses <meta name=description> when no OG/Twitter/LD description", () => {
		const html = `<meta name="description" content="plain desc">`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.description).toBe("plain desc");
	});

	it("falls back to URL hostname for title when everything missing", () => {
		const p = extractLinkPreview({ url: URL, html: "<html></html>" });
		expect(p.title).toBe("example.com");
	});

	it("falls back to URL hostname for siteName", () => {
		const html = "<title>Some Title</title>";
		const p = extractLinkPreview({ url: URL, html });
		expect(p.siteName).toBe("example.com");
	});

	it("returns empty description when none anywhere", () => {
		const html = "<title>x</title>";
		const p = extractLinkPreview({ url: URL, html });
		expect(p.description).toBe("");
	});

	it("defaults mediaType to 'page' when no og:type", () => {
		const html = "<title>x</title>";
		const p = extractLinkPreview({ url: URL, html });
		expect(p.mediaType).toBe("page");
	});

	it("trims whitespace from <title>", () => {
		const html = `<title>
			Padded Title
		</title>`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.title).toBe("Padded Title");
	});

	it("decodes HTML entities in <title>", () => {
		const html = "<title>Tom &amp; Jerry &lt;2026&gt;</title>";
		const p = extractLinkPreview({ url: URL, html });
		expect(p.title).toBe("Tom & Jerry <2026>");
	});
});

describe("extractLinkPreview — fall-through order", () => {
	it("OG description wins over Twitter, Twitter wins over JSON-LD, JSON-LD wins over <meta name=description>", () => {
		const html = `
			<meta property="og:description" content="og wins">
			<meta name="twitter:description" content="twitter loses to og">
			<script type="application/ld+json">{"description":"ld loses to og"}</script>
			<meta name="description" content="meta loses to og">
		`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.description).toBe("og wins");
	});

	it("twitter wins when no OG (and beats JSON-LD)", () => {
		const html = `
			<meta name="twitter:description" content="twitter wins">
			<script type="application/ld+json">{"description":"ld loses"}</script>
		`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.description).toBe("twitter wins");
	});

	it("URL fallback even when URL is malformed", () => {
		const p = extractLinkPreview({ url: "not a url", html: "<html></html>" });
		expect(p.title).toBe(""); // can't extract hostname from "not a url"
		expect(p.canonicalUrl).toBe("not a url");
	});
});

describe("extractLinkPreview — edge cases", () => {
	it("ignores empty OG content", () => {
		const html = `
			<meta property="og:title" content="">
			<title>Real Title</title>
		`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.title).toBe("Real Title");
	});

	it("ignores whitespace-only OG content", () => {
		const html = `
			<meta property="og:title" content="   ">
			<title>Real Title</title>
		`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.title).toBe("Real Title");
	});

	it("uses fetchedAt input or defaults to Date.now()", () => {
		const before = Date.now();
		const p = extractLinkPreview({ url: URL, html: "" });
		expect(p.fetchedAt).toBeGreaterThanOrEqual(before);
	});

	it("preserves the original URL even when og:url declares something else", () => {
		const html = `<meta property="og:url" content="https://canonical.example/x">`;
		const p = extractLinkPreview({ url: "https://shortlink.example/abc", html });
		expect(p.url).toBe("https://shortlink.example/abc");
		expect(p.canonicalUrl).toBe("https://canonical.example/x");
	});
});

describe("extractLinkPreview — favicon", () => {
	it("reads a rel=icon link and resolves a relative href against the page URL", () => {
		const html = `<link rel="icon" href="/assets/favicon-32.png">`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.favicon).toBe("https://example.com/assets/favicon-32.png");
	});

	it("resolves a root-relative path-less href against the origin", () => {
		const html = `<link rel="shortcut icon" href="favicon.ico">`;
		const p = extractLinkPreview({ url: "https://example.com/blog/post", html });
		expect(p.favicon).toBe("https://example.com/blog/favicon.ico");
	});

	it("keeps an already-absolute https favicon URL", () => {
		const html = `<link rel="icon" href="https://cdn.example.com/fav.png">`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.favicon).toBe("https://cdn.example.com/fav.png");
	});

	it("prefers a standard icon over apple-touch-icon", () => {
		const html = `
			<link rel="apple-touch-icon" href="/touch.png">
			<link rel="icon" href="/fav.png">
		`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.favicon).toBe("https://example.com/fav.png");
	});

	it("falls back to apple-touch-icon when no standard icon is declared", () => {
		const html = `<link rel="apple-touch-icon" href="/touch.png">`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.favicon).toBe("https://example.com/touch.png");
	});

	it("falls back to origin /favicon.ico when the page declares no icon link", () => {
		const p = extractLinkPreview({ url: "https://example.com/deep/page?q=1", html: "<html></html>" });
		expect(p.favicon).toBe("https://example.com/favicon.ico");
	});

	it("drops a javascript: / data: / file: favicon href and uses the default", () => {
		for (const evil of ["javascript:alert(1)", "data:image/png;base64,AAAA", "file:///etc/passwd"]) {
			const html = `<link rel="icon" href="${evil}">`;
			const p = extractLinkPreview({ url: URL, html });
			expect(p.favicon).toBe("https://example.com/favicon.ico");
		}
	});

	it("decodes entities in the favicon href before resolving", () => {
		const html = `<link rel="icon" href="/fav.png?a=1&amp;b=2">`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.favicon).toBe("https://example.com/fav.png?a=1&b=2");
	});

	it("is empty only when the page URL itself is unparseable", () => {
		const p = extractLinkPreview({ url: "not a url", html: "<html></html>" });
		expect(p.favicon).toBe("");
	});
});

describe("extractLinkPreview — author / publishedAt (9.18.6)", () => {
	it("reads <meta name=author> as the author", () => {
		const html = `<meta name="author" content="Jane Doe">`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.author).toBe("Jane Doe");
	});

	it("prefers JSON-LD author.name over meta author", () => {
		const html = `
			<meta name="author" content="Meta Jane">
			<script type="application/ld+json">{"author": {"name": "LD Jane"}}</script>
		`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.author).toBe("LD Jane");
	});

	it("accepts a JSON-LD author array and a bare-string author", () => {
		const arr = `<script type="application/ld+json">{"author": [{"name": "First Author"}, {"name": "Second"}]}</script>`;
		expect(extractLinkPreview({ url: URL, html: arr }).author).toBe("First Author");
		const str = `<script type="application/ld+json">{"author": "String Author"}</script>`;
		expect(extractLinkPreview({ url: URL, html: str }).author).toBe("String Author");
	});

	it("uses a non-URL article:author as last resort", () => {
		const html = `<meta property="article:author" content="OG Jane">`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.author).toBe("OG Jane");
	});

	it("drops a URL-shaped article:author (profile link, not a name)", () => {
		const html = `<meta property="article:author" content="https://facebook.com/jane">`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.author).toBeUndefined();
	});

	it("omits author when the page declares none", () => {
		const p = extractLinkPreview({ url: URL, html: "<html></html>" });
		expect(p.author).toBeUndefined();
	});

	it("parses article:published_time to epoch ms", () => {
		const html = `<meta property="article:published_time" content="2024-03-05T12:00:00Z">`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.publishedAt).toBe(Date.parse("2024-03-05T12:00:00Z"));
	});

	it("falls back to JSON-LD datePublished", () => {
		const html = `<script type="application/ld+json">{"datePublished": "2023-11-20"}</script>`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.publishedAt).toBe(Date.parse("2023-11-20"));
	});

	it("prefers article:published_time over JSON-LD datePublished", () => {
		const html = `
			<meta property="article:published_time" content="2024-01-01T00:00:00Z">
			<script type="application/ld+json">{"datePublished": "2020-01-01"}</script>
		`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.publishedAt).toBe(Date.parse("2024-01-01T00:00:00Z"));
	});

	it("omits publishedAt when the value is unparseable", () => {
		const html = `<meta property="article:published_time" content="not a date">`;
		const p = extractLinkPreview({ url: URL, html });
		expect(p.publishedAt).toBeUndefined();
	});

	it("omits publishedAt when the page declares none", () => {
		const p = extractLinkPreview({ url: URL, html: "<html></html>" });
		expect(p.publishedAt).toBeUndefined();
	});
});
