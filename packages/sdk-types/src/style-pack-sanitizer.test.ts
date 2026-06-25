import { describe, expect, it } from "vitest";
import {
	StylePackSanitizeCode,
	StylePackSanitizeSeverity,
	isStylePackCssSafe,
	sanitizeStylePackCss,
} from "./style-pack-sanitizer";

function codes(css: string): StylePackSanitizeCode[] {
	return sanitizeStylePackCss(css).map((i) => i.code);
}

describe("sanitizeStylePackCss — clean input", () => {
	it("passes plain token-driven CSS", () => {
		const css = `[data-bs-region="dashboard-header"] { background: var(--color-accent-default); border-radius: 8px; }`;
		expect(sanitizeStylePackCss(css)).toEqual([]);
		expect(isStylePackCssSafe(css)).toBe(true);
	});

	it("empty / non-string input is clean", () => {
		expect(sanitizeStylePackCss("")).toEqual([]);
		expect(sanitizeStylePackCss(undefined as unknown as string)).toEqual([]);
	});

	it("allows a local relative url()", () => {
		expect(sanitizeStylePackCss("a { background: url('./bg.png'); }")).toEqual([]);
	});
});

describe("sanitizeStylePackCss — script + network + exfil vectors", () => {
	it("rejects javascript: / vbscript: schemes", () => {
		expect(codes("a { background: url(javascript:alert(1)); }")).toContain(
			StylePackSanitizeCode.ScriptUrl,
		);
		expect(codes("a { x: vbscript:foo; }")).toContain(StylePackSanitizeCode.ScriptUrl);
	});

	it("rejects @import", () => {
		expect(codes('@import "evil.css";')).toContain(StylePackSanitizeCode.NetworkImport);
		expect(codes("@import url(https://x.test/a.css);")).toContain(
			StylePackSanitizeCode.NetworkImport,
		);
	});

	it("rejects -moz-binding", () => {
		expect(codes("a { -moz-binding: url(x.xml#y); }")).toContain(StylePackSanitizeCode.MozBinding);
	});

	it("rejects behavior: (incl. -ms- prefix)", () => {
		expect(codes("a { behavior: url(x.htc); }")).toContain(StylePackSanitizeCode.Behavior);
		expect(codes("a { -ms-behavior: url(x.htc); }")).toContain(StylePackSanitizeCode.Behavior);
	});

	it("rejects expression() even with whitespace obfuscation", () => {
		expect(codes("a { width: expression ( alert(1) ); }")).toContain(
			StylePackSanitizeCode.Expression,
		);
	});

	it("rejects external network url() (http/https/protocol-relative)", () => {
		expect(codes("a { background: url(https://evil.test/p.png); }")).toContain(
			StylePackSanitizeCode.ExternalResource,
		);
		expect(codes("a { background: url(//evil.test/p.png); }")).toContain(
			StylePackSanitizeCode.ExternalResource,
		);
		expect(codes('@font-face { src: url("http://x.test/f.woff"); }')).toContain(
			StylePackSanitizeCode.ExternalResource,
		);
	});

	it("warns (not errors) on data: URIs", () => {
		const issues = sanitizeStylePackCss("a { background: url(data:image/png;base64,AAAA); }");
		expect(issues.map((i) => i.code)).toContain(StylePackSanitizeCode.DataUri);
		expect(issues.every((i) => i.severity === StylePackSanitizeSeverity.Warning)).toBe(true);
		// A warning-only pack is still installable.
		expect(isStylePackCssSafe("a { background: url(data:image/png;base64,AAAA); }")).toBe(true);
	});
});

describe("sanitizeStylePackCss — obfuscation + reporting", () => {
	it("sees through comments without losing line numbers", () => {
		const css = ".ok {}\n/* hi */\na { width: expression(x); }";
		const issues = sanitizeStylePackCss(css);
		const expr = issues.find((i) => i.code === StylePackSanitizeCode.Expression);
		expect(expr?.line).toBe(3);
	});

	it("a comment between token and colon can't hide a payload", () => {
		// Stripping the comment to whitespace + the pattern's `\s*` means the
		// split form is still caught (fail-closed).
		expect(codes("a { x: -moz-binding/* */: url(x); }")).toContain(StylePackSanitizeCode.MozBinding);
		expect(codes("a { x: -moz-binding: url(x); }")).toContain(StylePackSanitizeCode.MozBinding);
	});

	it("sorts findings by line then code", () => {
		const css = "a { width: expression(x); }\nb { background: url(https://e.test/x); }";
		const issues = sanitizeStylePackCss(css);
		expect(issues[0]?.line).toBeLessThanOrEqual(issues[1]?.line ?? Number.POSITIVE_INFINITY);
	});

	it("isStylePackCssSafe is false when any error-severity finding exists", () => {
		expect(isStylePackCssSafe("@import 'x';")).toBe(false);
	});
});

describe("sanitizeStylePackCss — CSS character-escape bypasses (decoded before scan)", () => {
	it("catches an escaped url() keyword (\\75 rl)", () => {
		expect(codes("a { background: \\75 rl(https://evil.test/x); }")).toContain(
			StylePackSanitizeCode.ExternalResource,
		);
	});

	it("catches an escaped @import (@\\69 mport)", () => {
		expect(codes('@\\69 mport "https://evil.test/x.css";')).toContain(
			StylePackSanitizeCode.NetworkImport,
		);
	});

	it("catches an escaped javascript: scheme", () => {
		expect(codes("a { x: \\6a avascript:alert(1); }")).toContain(StylePackSanitizeCode.ScriptUrl);
	});

	it("catches escaped slashes in a network URL (https:\\2f\\2f)", () => {
		expect(codes("a { background: url(https:\\2f\\2f evil.test/x); }")).toContain(
			StylePackSanitizeCode.ExternalResource,
		);
	});

	it("catches a bare absolute URL anywhere + image-set network refs", () => {
		expect(codes("a { content: 'https://evil.test/x'; }")).toContain(
			StylePackSanitizeCode.ExternalResource,
		);
		expect(codes('a { background: image-set("https://evil.test/x" 1x); }')).toContain(
			StylePackSanitizeCode.ExternalResource,
		);
	});

	it("still allows a local relative url() (no false positive)", () => {
		expect(sanitizeStylePackCss("a { background: url('./bg.png'); }")).toEqual([]);
		expect(sanitizeStylePackCss(".x { color: var(--color-accent-default); }")).toEqual([]);
	});
});
