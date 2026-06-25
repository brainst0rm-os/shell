import { describe, expect, it } from "vitest";
import { sanitizeMailHtml } from "./mail-sanitize";

describe("sanitizeMailHtml (sanitize-html parser)", () => {
	it("returns empty for empty / non-string input", () => {
		expect(sanitizeMailHtml("")).toBe("");
		expect(sanitizeMailHtml(undefined as unknown as string)).toBe("");
	});

	it("drops script elements and their contents", () => {
		const out = sanitizeMailHtml("<p>hi</p><script>steal(document.cookie)</script>");
		expect(out).toContain("<p>hi</p>");
		expect(out).not.toContain("steal");
		expect(out).not.toContain("<script");
	});

	it("drops style/iframe/object/form/svg/meta/base/link whole", () => {
		for (const tag of ["style", "iframe", "object", "form", "svg"]) {
			const out = sanitizeMailHtml(`<p>keep</p><${tag}>x</${tag}>`);
			expect(out).not.toContain(`<${tag}`);
			expect(out).toContain("keep");
		}
		expect(sanitizeMailHtml('<base href="https://evil.com/"><p>k</p>')).not.toContain("<base");
		expect(sanitizeMailHtml('<meta http-equiv="refresh"><p>k</p>')).not.toContain("<meta");
		expect(sanitizeMailHtml('<link rel="stylesheet" href="x"><p>k</p>')).not.toContain("<link");
	});

	it("strips on* event handlers in all quote forms", () => {
		const out = sanitizeMailHtml(`<a href="#" onclick="x()" onmouseover='y()' onfocus=z>link</a>`);
		expect(out).not.toMatch(/onclick/i);
		expect(out).not.toMatch(/onmouseover/i);
		expect(out).not.toMatch(/onfocus/i);
		expect(out).toContain(">link</a>");
	});

	it("drops dangerous-scheme href/src entirely (quoted AND unquoted)", () => {
		// The regex predecessor only matched QUOTED values — the parser catches both.
		for (const html of [
			'<a href="javascript:alert(1)">x</a>',
			"<a href=javascript:alert(1)>x</a>",
			'<a href="vbscript:msgbox(1)">x</a>',
		]) {
			const out = sanitizeMailHtml(html);
			expect(out).not.toMatch(/javascript:/i);
			expect(out).not.toMatch(/vbscript:/i);
			expect(out).toContain(">x</a>");
		}
		expect(sanitizeMailHtml('<img src="data:text/html,<script>x</script>">')).not.toContain(
			"data:text/html",
		);
	});

	it("drops data: and protocol-relative URLs (incl. data:image/svg+xml)", () => {
		expect(sanitizeMailHtml('<img src="data:image/svg+xml,<svg onload=alert(1)>">')).not.toContain(
			"data:image",
		);
		expect(sanitizeMailHtml('<img src="data:image/png;base64,AAAA">')).not.toContain("data:");
		expect(sanitizeMailHtml('<img src="//cdn.example.com/a.png">')).not.toContain("cdn.example.com");
	});

	it("forces rel=noopener noreferrer nofollow on links (reverse-tabnabbing + referrer)", () => {
		const out = sanitizeMailHtml('<a href="https://example.com/x" target="_blank">x</a>');
		expect(out).toContain('rel="noopener noreferrer nofollow"');
		expect(out).toContain('href="https://example.com/x"');
	});

	it("preserves safe links and remote http(s) images (viewer blocks images via CSP)", () => {
		expect(sanitizeMailHtml('<a href="https://example.com/x">x</a>')).toContain(
			'href="https://example.com/x"',
		);
		expect(sanitizeMailHtml('<img src="https://cdn.example.com/a.png">')).toContain(
			'src="https://cdn.example.com/a.png"',
		);
	});

	it("keeps rich mail formatting: tables, inline styles, font", () => {
		const out = sanitizeMailHtml(
			'<table><tr><td style="color:red" bgcolor="#eee"><font face="Arial">cell</font></td></tr></table>',
		);
		expect(out).toContain("<table>");
		expect(out).toContain("<td");
		expect(out).toContain("color:red");
		expect(out).toContain("cell");
	});

	it("resists `>` inside a quoted attribute (regex mXSS the parser defeats)", () => {
		const out = sanitizeMailHtml('<iframe title="a>b" srcdoc="<script>x</script>"><p>safe</p>');
		expect(out).not.toContain("<iframe");
		expect(out).not.toContain("srcdoc");
		expect(out).not.toContain("<script");
	});

	it("removes comments (conditional-comment hiding)", () => {
		expect(sanitizeMailHtml("<!--[if IE]><script>x</script><![endif]--><p>k</p>")).not.toContain(
			"script",
		);
	});
});
