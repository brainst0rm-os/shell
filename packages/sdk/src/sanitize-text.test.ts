import { describe, expect, it } from "vitest";
import { sanitizeInlineText } from "./sanitize-text";

const ZWSP = String.fromCharCode(0x200b);
const ZWNJ = String.fromCharCode(0x200c);
const ZWJ = String.fromCharCode(0x200d);
const RLO = String.fromCharCode(0x202e);
const LRE = String.fromCharCode(0x202a);
const LRI = String.fromCharCode(0x2066);
const PDI = String.fromCharCode(0x2069);
const NUL = String.fromCharCode(0x00);
const DEL = String.fromCharCode(0x7f);
const BOM = String.fromCharCode(0xfeff);

describe("sanitizeInlineText", () => {
	it("passes a plain string through", () => {
		expect(sanitizeInlineText("Example Domain", 100)).toBe("Example Domain");
	});

	it("returns empty string for non-string input", () => {
		expect(sanitizeInlineText(undefined, 10)).toBe("");
		expect(sanitizeInlineText(null, 10)).toBe("");
		expect(sanitizeInlineText(42, 10)).toBe("");
		expect(sanitizeInlineText({ toString: () => "x" }, 10)).toBe("");
	});

	it("strips C0/C1 controls, DEL, zero-width, bidi overrides, and BOM", () => {
		expect(sanitizeInlineText(`a${NUL}bcd${DEL}e`, 100)).toBe("abcde");
		expect(sanitizeInlineText(`a${ZWSP}b${ZWNJ}c${ZWJ}d`, 100)).toBe("abcd");
		expect(sanitizeInlineText(`a${RLO}b${LRE}c${LRI}d${PDI}e`, 100)).toBe("abcde");
		expect(sanitizeInlineText(`${BOM}title`, 100)).toBe("title");
	});

	it("collapses whitespace runs (including newlines/tabs) and trims", () => {
		expect(sanitizeInlineText("  a \t\n b\r\n  c  ", 100)).toBe("a b c");
	});

	it("returns empty string when nothing survives stripping", () => {
		expect(sanitizeInlineText(`${ZWSP}${RLO} \t `, 100)).toBe("");
	});

	it("clamps to maxLength code units", () => {
		expect(sanitizeInlineText("abcdef", 3)).toBe("abc");
		expect(sanitizeInlineText("a".repeat(1000), 64)).toHaveLength(64);
	});

	it("keeps non-ASCII text and emoji intact", () => {
		expect(sanitizeInlineText("título — 日本語 🚀", 100)).toBe("título — 日本語 🚀");
	});
});
