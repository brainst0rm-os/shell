import { describe, expect, it } from "vitest";
import { domainFromUrl, fallbackColorFor, isValidHttpUrl, normalizeUrl } from "./url-parse";

describe("normalizeUrl", () => {
	it("passes through a full https URL", () => {
		expect(normalizeUrl("https://anthropic.com/research")).toBe("https://anthropic.com/research");
	});

	it("trims surrounding whitespace", () => {
		expect(normalizeUrl("  https://anthropic.com/research  ")).toBe("https://anthropic.com/research");
	});

	it("prepends https:// when scheme is missing", () => {
		expect(normalizeUrl("anthropic.com")).toBe("https://anthropic.com");
		expect(normalizeUrl("anthropic.com/research")).toBe("https://anthropic.com/research");
	});

	it("preserves http:// when explicitly given", () => {
		expect(normalizeUrl("http://anthropic.com")).toBe("http://anthropic.com");
	});

	it("lowercases the host but preserves path case", () => {
		expect(normalizeUrl("https://ANTHROPIC.com/Research")).toBe("https://anthropic.com/Research");
	});

	it("strips the trailing slash on a bare root, preserves it on a real path", () => {
		expect(normalizeUrl("https://anthropic.com/")).toBe("https://anthropic.com");
		expect(normalizeUrl("https://anthropic.com/research/")).toBe("https://anthropic.com/research/");
	});

	it("preserves query strings + fragments untouched (no UTM stripping in v1)", () => {
		expect(normalizeUrl("https://anthropic.com/?utm_source=x#hash")).toBe(
			"https://anthropic.com/?utm_source=x#hash",
		);
	});

	it("returns null for empty / whitespace-only / non-http schemes / malformed input", () => {
		expect(normalizeUrl("")).toBeNull();
		expect(normalizeUrl("   ")).toBeNull();
		expect(normalizeUrl("mailto:hi@x.com")).toBeNull();
		expect(normalizeUrl("javascript:alert(1)")).toBeNull();
		expect(normalizeUrl("ftp://example.com")).toBeNull();
	});

	it("rejects URLs with an empty hostname (e.g. `https://`)", () => {
		expect(normalizeUrl("https://")).toBeNull();
		expect(normalizeUrl("https:///path")).toBeNull();
	});
});

describe("isValidHttpUrl", () => {
	it("true for inputs `normalizeUrl` accepts", () => {
		expect(isValidHttpUrl("https://anthropic.com")).toBe(true);
		expect(isValidHttpUrl("anthropic.com")).toBe(true);
	});

	it("false for inputs `normalizeUrl` rejects", () => {
		expect(isValidHttpUrl("")).toBe(false);
		expect(isValidHttpUrl("not a url")).toBe(false);
		expect(isValidHttpUrl("mailto:hi@x.com")).toBe(false);
	});
});

describe("domainFromUrl", () => {
	it("extracts the hostname", () => {
		expect(domainFromUrl("https://anthropic.com/research")).toBe("anthropic.com");
		expect(domainFromUrl("https://docs.anthropic.com/")).toBe("docs.anthropic.com");
	});

	it("returns null for malformed input", () => {
		expect(domainFromUrl("not a url")).toBeNull();
		expect(domainFromUrl("")).toBeNull();
	});
});

describe("fallbackColorFor", () => {
	it("returns a 7-char `#rrggbb` string", () => {
		expect(fallbackColorFor("anthropic.com")).toMatch(/^#[0-9a-f]{6}$/);
	});

	it("is deterministic — same seed always returns the same colour", () => {
		const a = fallbackColorFor("anthropic.com");
		const b = fallbackColorFor("anthropic.com");
		expect(a).toBe(b);
	});

	it("different seeds produce different colours (with high probability)", () => {
		const a = fallbackColorFor("anthropic.com");
		const b = fallbackColorFor("openai.com");
		expect(a).not.toBe(b);
	});
});
