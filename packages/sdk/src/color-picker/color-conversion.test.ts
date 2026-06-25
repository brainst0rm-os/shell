import { describe, expect, it } from "vitest";
import { hexToHsv, hsvToHex, normalizeHex } from "./color-conversion";

describe("normalizeHex", () => {
	it("canonicalises 6-digit hex regardless of case or leading #", () => {
		expect(normalizeHex("#AABBCC")).toBe("#aabbcc");
		expect(normalizeHex("aabbcc")).toBe("#aabbcc");
		expect(normalizeHex("  #AaBbCc  ")).toBe("#aabbcc");
	});

	it("expands 3-digit shorthand", () => {
		expect(normalizeHex("#abc")).toBe("#aabbcc");
		expect(normalizeHex("f0a")).toBe("#ff00aa");
	});

	it("rejects anything it cannot represent", () => {
		expect(normalizeHex("red")).toBeNull();
		expect(normalizeHex("rgba(0,0,0,0.5)")).toBeNull();
		expect(normalizeHex("var(--x)")).toBeNull();
		expect(normalizeHex("#12345")).toBeNull();
	});
});

describe("hsvToHex / hexToHsv", () => {
	it("maps primaries", () => {
		expect(hsvToHex(0, 100, 100)).toBe("#ff0000");
		expect(hsvToHex(120, 100, 100)).toBe("#00ff00");
		expect(hsvToHex(240, 100, 100)).toBe("#0000ff");
	});

	it("maps black and white", () => {
		expect(hsvToHex(0, 0, 0)).toBe("#000000");
		expect(hsvToHex(0, 0, 100)).toBe("#ffffff");
	});

	it("wraps and clamps out-of-range hue", () => {
		expect(hsvToHex(360, 100, 100)).toBe("#ff0000");
		expect(hsvToHex(-120, 100, 100)).toBe("#0000ff");
	});

	// HSV stores S/V as integer percents, so a hex→HSV→hex round-trip is only
	// near-exact (±1 per channel from the rounding), not bit-identical.
	it("round-trips representative colours within rounding tolerance", () => {
		const channels = (hex: string): number[] => {
			const int = Number.parseInt(hex.slice(1), 16);
			return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
		};
		for (const hex of ["#3366cc", "#abcdef", "#10b981", "#808080"]) {
			const hsv = hexToHsv(hex);
			expect(hsv).not.toBeNull();
			if (!hsv) continue;
			const back = channels(hsvToHex(hsv.h, hsv.s, hsv.v));
			const orig = channels(hex);
			for (const [i, channel] of back.entries())
				expect(Math.abs(channel - (orig[i] ?? 0))).toBeLessThanOrEqual(2);
		}
	});

	it("returns null for unparseable hex", () => {
		expect(hexToHsv("nope")).toBeNull();
	});
});
