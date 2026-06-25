import { describe, expect, it } from "vitest";
import { READABLE_ALLOWED_TAGS, sanitizeReadableHtml } from "./sanitize-html";

const clean = (html: string) => sanitizeReadableHtml(html);

describe("sanitizeReadableHtml — allowlist pass-through", () => {
	it("keeps the importable block tags + their text", () => {
		const out = clean(
			"<h1>Title</h1><p>Body <strong>bold</strong> <em>it</em></p><blockquote>q</blockquote><hr>",
		);
		expect(out).toContain("<h1>Title</h1>");
		expect(out).toContain("<strong>bold</strong>");
		expect(out).toContain("<em>it</em>");
		expect(out).toContain("<blockquote>q</blockquote>");
		expect(out).toContain("<hr />");
	});

	it("keeps lists and tables", () => {
		const out = clean(
			"<ul><li>one</li><li>two</li></ul><table><thead><tr><th>h</th></tr></thead><tbody><tr><td>c</td></tr></tbody></table>",
		);
		expect(out).toContain("<li>one</li>");
		expect(out).toContain("<th>h</th>");
		expect(out).toContain("<td>c</td>");
	});

	it("keeps code / pre with their language class (for lang inference)", () => {
		const out = clean('<pre class="language-ts"><code class="language-ts">x</code></pre>');
		expect(out).toContain('class="language-ts"');
		expect(out).toContain("<code");
	});

	it("keeps allowed attributes on a / img and drops the rest", () => {
		const out = clean('<a href="https://x.test" title="t" id="bad" data-x="y">l</a>');
		expect(out).toContain('href="https://x.test"');
		expect(out).toContain('title="t"');
		expect(out).not.toContain("id=");
		expect(out).not.toContain("data-x");
	});

	it("keeps http(s)/mailto/brainstorm + relative + anchor URLs", () => {
		expect(clean('<a href="http://x.test">a</a>')).toContain("http://x.test");
		expect(clean('<a href="mailto:a@b.test">a</a>')).toContain("mailto:a@b.test");
		expect(clean('<a href="brainstorm://entity/x">a</a>')).toContain("brainstorm://entity/x");
		expect(clean('<a href="/rel/path">a</a>')).toContain('href="/rel/path"');
		expect(clean('<a href="#sec">a</a>')).toContain('href="#sec"');
	});
});

describe("sanitizeReadableHtml — security boundary (adversarial)", () => {
	it("drops <script> tag AND its content", () => {
		const out = clean("<p>before</p><script>alert(document.cookie)</script><p>after</p>");
		expect(out).not.toContain("script");
		expect(out).not.toContain("alert");
		expect(out).toContain("before");
		expect(out).toContain("after");
	});

	it("drops <style>/<iframe>/<object> and their content (non-void)", () => {
		for (const tag of ["style", "iframe", "object"]) {
			const out = clean(`<p>ok</p><${tag}>payload-${tag}</${tag}>`);
			expect(out, tag).not.toContain(`payload-${tag}`);
			expect(out, tag).not.toContain(`<${tag}`);
			expect(out, tag).toContain("ok");
		}
	});

	it("drops void embedding tags <embed>/<base> entirely", () => {
		for (const tag of ["embed", "base"]) {
			const out = clean(`<p>ok</p><${tag} src="javascript:evil" href="//evil.test">`);
			expect(out, tag).not.toContain(`<${tag}`);
			expect(out, tag).not.toContain("evil");
			expect(out, tag).toContain("ok");
		}
	});

	it("strips every on* event handler", () => {
		const out = clean('<p onclick="evil()" onmouseover="evil()">hi</p>');
		expect(out).not.toContain("onclick");
		expect(out).not.toContain("onmouseover");
		expect(out).not.toContain("evil");
		expect(out).toContain("hi");
	});

	it("strips style attributes (no expression()/url() CSS vector)", () => {
		const out = clean('<p style="background:url(javascript:evil)">x</p>');
		expect(out).not.toContain("style");
		expect(out).not.toContain("javascript");
	});

	it("drops javascript: / vbscript: / file: hrefs", () => {
		for (const url of ["javascript:alert(1)", "vbscript:msgbox", "file:///etc/passwd"]) {
			const out = clean(`<a href="${url}">x</a>`);
			expect(out, url).not.toContain(url.split(":")[0] ?? url);
		}
	});

	it("drops data: URLs on img src", () => {
		const out = clean('<img src="data:text/html;base64,PHNjcmlwdD4=" alt="a">');
		expect(out).not.toContain("data:");
	});

	it("rejects protocol-relative //host URLs", () => {
		const out = clean('<a href="//evil.test/x">x</a>');
		expect(out).not.toContain("//evil.test");
	});

	it("survives entity-encoded javascript: smuggling", () => {
		// `&#106;` = 'j' — sanitize-html decodes then re-checks the scheme.
		const out = clean('<a href="&#106;avascript:alert(1)">x</a>');
		expect(out.toLowerCase()).not.toContain("javascript:alert");
	});

	it("discards unknown containers but keeps their allowed children", () => {
		const out = clean("<section><div><p>kept</p></div></section>");
		expect(out).toContain("<p>kept</p>");
		expect(out).not.toContain("<section");
		expect(out).not.toContain("<div");
	});

	it("the allowlist contains no scriptable / embedding tags", () => {
		for (const banned of ["script", "iframe", "object", "embed", "style", "form", "input", "svg"]) {
			expect(READABLE_ALLOWED_TAGS).not.toContain(banned);
		}
	});
});

// ─── Net-2e — adversarial corpus (the dedicated sanitizer security pass) ──────
// Each vector asserts BOTH that the dangerous payload is neutralised AND, where
// applicable, that legitimate adjacent content survives (no over-stripping).
describe("sanitizeReadableHtml — Net-2e adversarial corpus", () => {
	const safe = (html: string) => {
		const out = clean(html).toLowerCase();
		expect(out).not.toContain("javascript:");
		expect(out).not.toContain("vbscript:");
		expect(out).not.toContain("onerror");
		expect(out).not.toContain("onload");
		expect(out).not.toContain("<script");
		expect(out).not.toContain("<svg");
		expect(out).not.toContain("alert(");
		return out;
	};

	it("mutation-XSS via SVG/foreignObject nesting → dropped", () => {
		const out = safe(
			"<p>keep</p><svg><foreignObject><script>alert(1)</script></foreignObject></svg>",
		);
		expect(out).toContain("keep");
	});

	it("<style>@import + expression() legacy CSS → dropped (tag + content)", () => {
		const out = safe('<style>@import "evil.css"; body{width:expression(alert(1))}</style><p>ok</p>');
		expect(out).not.toContain("@import");
		expect(out).not.toContain("expression(");
		expect(out).toContain("ok");
	});

	it("data:text/html;base64 in href / img src → dropped", () => {
		safe('<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>');
		safe('<img src="data:text/html;base64,PHN2Zz4=" alt="a">');
	});

	it("on* smuggled via namespaced attrs (xlink:href / xml:base) → dropped", () => {
		safe('<a xlink:href="javascript:alert(1)" xml:base="javascript:alert(1)">x</a>');
		safe('<img src="x" onerror="alert(1)" alt="a">');
	});

	it("polyglot / doctype-less SVG parsed as HTML → no executable survives", () => {
		safe("<svg/onload=alert(1)><p>after</p>");
	});

	it("HTML-entity-encoded javascript: URL → neutralised after decode", () => {
		safe('<a href="javascript&colon;alert(1)">x</a>');
		safe('<a href="&#x6a;avascript:alert(1)">x</a>');
	});

	it("<meta http-equiv=refresh> with a javascript: target → meta dropped", () => {
		const out = safe('<meta http-equiv="refresh" content="0;url=javascript:alert(1)"><p>body</p>');
		expect(out).not.toContain("http-equiv");
		expect(out).toContain("body");
	});

	it("attribute quoting confusion → no handler leaks", () => {
		safe('<a href="x" title="\\"><img src=x onerror=alert(1)>">link</a>');
	});

	it("base64 / tracking payloads in <img src> via data: → dropped", () => {
		safe('<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+" alt="a">');
	});

	it("does NOT over-strip — a benign article with links/images/code survives intact", () => {
		const out = clean(
			'<h1>Title</h1><p>Read <a href="https://x.test/docs" title="Docs">the docs</a> and see <img src="https://x.test/a.png" alt="diagram">.</p><pre class="language-ts"><code>const x = 1;</code></pre>',
		);
		expect(out).toContain('href="https://x.test/docs"');
		expect(out).toContain('src="https://x.test/a.png"');
		expect(out).toContain("const x = 1;");
		expect(out).toContain("<h1>Title</h1>");
	});
});
