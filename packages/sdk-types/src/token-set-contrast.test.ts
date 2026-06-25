import { describe, expect, it } from "vitest";
import {
	CONTRAST_PAIRS,
	ContrastLevel,
	contrastRatio,
	lintTokenContrast,
	parseColor,
} from "./token-set-contrast";

describe("parseColor", () => {
	it("parses #rgb / #rrggbb / #rrggbbaa", () => {
		expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
		expect(parseColor("#000000")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
		expect(parseColor("#ff000080")?.a).toBeCloseTo(0.5, 1);
	});

	it("parses rgb() / rgba() incl. modern slash syntax", () => {
		expect(parseColor("rgb(255, 0, 0)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
		expect(parseColor("rgba(0,0,0,0.5)")?.a).toBe(0.5);
		expect(parseColor("rgb(0 0 0 / 50%)")?.a).toBe(0.5);
	});

	it("returns null for unevaluable colours", () => {
		expect(parseColor("var(--x)")).toBeNull();
		expect(parseColor("rebeccapurple")).toBeNull();
		expect(parseColor("linear-gradient(#fff, #000)")).toBeNull();
		expect(parseColor(undefined)).toBeNull();
	});
});

describe("contrastRatio", () => {
	it("black on white is 21:1", () => {
		expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 0);
	});

	it("white on white is 1:1", () => {
		expect(contrastRatio("#fff", "#fff")).toBeCloseTo(1, 5);
	});

	it("composites a translucent foreground over the background", () => {
		// Fully transparent fg → equals the bg → ratio 1.
		expect(contrastRatio("rgba(0,0,0,0)", "#fff")).toBeCloseTo(1, 5);
	});

	it("returns null when a colour is unparseable", () => {
		expect(contrastRatio("var(--x)", "#fff")).toBeNull();
	});
});

describe("lintTokenContrast", () => {
	function resolverFrom(map: Record<string, string>): (t: string) => string | undefined {
		return (t) => map[t];
	}

	it("passes a high-contrast scheme", () => {
		const issues = lintTokenContrast(
			resolverFrom({
				"--color-text-primary": "#111111",
				"--color-background-primary": "#ffffff",
			}),
		);
		expect(issues.find((i) => i.pairId === "text-on-bg")).toBeUndefined();
	});

	it("flags low-contrast primary text", () => {
		const issues = lintTokenContrast(
			resolverFrom({
				"--color-text-primary": "#bbbbbb",
				"--color-background-primary": "#ffffff",
			}),
		);
		const fail = issues.find((i) => i.pairId === "text-on-bg");
		expect(fail).toBeDefined();
		expect(fail?.required).toBe(ContrastLevel.Normal);
		expect(fail?.ratio).toBeLessThan(4.5);
	});

	it("skips pairs whose colours can't be evaluated", () => {
		const issues = lintTokenContrast(
			resolverFrom({
				"--color-text-primary": "var(--x)",
				"--color-background-primary": "#fff",
			}),
		);
		expect(issues.find((i) => i.pairId === "text-on-bg")).toBeUndefined();
	});

	it("every pair names a foreground + background + level", () => {
		for (const p of CONTRAST_PAIRS) {
			expect(p.foreground.startsWith("--color-")).toBe(true);
			expect(p.background.startsWith("--color-")).toBe(true);
			expect([ContrastLevel.Normal, ContrastLevel.Large]).toContain(p.level);
		}
	});
});
