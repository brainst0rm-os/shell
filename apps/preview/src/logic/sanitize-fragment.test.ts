// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeToFragment } from "./sanitize-fragment";

function html(input: string): HTMLElement {
	const wrap = document.createElement("div");
	wrap.appendChild(sanitizeToFragment(input, document));
	return wrap;
}

/** Query that asserts a match exists — avoids non-null assertions in tests. */
function q(input: string, selector: string): Element {
	const el = html(input).querySelector(selector);
	if (!el) throw new Error(`expected a <${selector}> in sanitized output`);
	return el;
}

describe("sanitizeToFragment", () => {
	it("keeps allowlisted structure + text", () => {
		const out = html("<h1>Title</h1><p>Some <strong>bold</strong> text</p>");
		expect(out.querySelector("h1")?.textContent).toBe("Title");
		expect(out.querySelector("strong")?.textContent).toBe("bold");
	});

	it("drops <script> entirely — content must not survive", () => {
		const out = html("<p>before</p><script>alert(1)</script><p>after</p>");
		expect(out.querySelector("script")).toBeNull();
		expect(out.textContent).toBe("beforeafter");
	});

	it("strips event handlers, style and class attributes", () => {
		const p = q('<p onclick="evil()" style="x" class="y">hi</p>', "p");
		expect(p.hasAttribute("onclick")).toBe(false);
		expect(p.hasAttribute("style")).toBe(false);
		expect(p.hasAttribute("class")).toBe(false);
		expect(p.textContent).toBe("hi");
	});

	it("allows safe hrefs and rejects javascript: URLs", () => {
		const ok = q('<a href="https://example.com">x</a>', "a");
		expect(ok.getAttribute("href")).toBe("https://example.com");
		expect(ok.getAttribute("rel")).toBe("noopener noreferrer");
		const bad = q('<a href="javascript:alert(1)">x</a>', "a");
		expect(bad.hasAttribute("href")).toBe(false);
	});

	it("keeps embedded data: images but drops remote image src", () => {
		const data = q('<img src="data:image/png;base64,AAAA" alt="pic">', "img");
		expect(data.getAttribute("src")).toContain("data:image/png");
		const remote = q('<img src="https://evil.example/track.gif">', "img");
		expect(remote.hasAttribute("src")).toBe(false);
	});

	it("unwraps unknown tags but preserves their text", () => {
		const out = html("<font color=red>kept <marquee>text</marquee></font>");
		expect(out.querySelector("font")).toBeNull();
		expect(out.querySelector("marquee")).toBeNull();
		expect(out.textContent).toBe("kept text");
	});

	it("clamps table colspan to a sane integer", () => {
		const td = q("<table><tr><td colspan='99999999'>x</td></tr></table>", "td");
		expect(td.getAttribute("colspan")).toBe("1000");
		const bad = q("<table><tr><td colspan='abc'>x</td></tr></table>", "td");
		expect(bad.hasAttribute("colspan")).toBe(false);
	});
});
