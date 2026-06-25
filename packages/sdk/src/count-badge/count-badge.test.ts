/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";
import { createCountBadge } from "./count-badge";
import { CountBadgeTone, countBadgeClassName, formatCount } from "./format-count";

describe("formatCount", () => {
	it("renders the raw count by default", () => {
		expect(formatCount(0)).toBe("0");
		expect(formatCount(16)).toBe("16");
	});

	it("caps at max with a trailing +", () => {
		expect(formatCount(120, 99)).toBe("99+");
		expect(formatCount(99, 99)).toBe("99");
		expect(formatCount(100, 99)).toBe("99+");
	});

	it("ignores a non-finite max", () => {
		expect(formatCount(120, Number.NaN)).toBe("120");
	});
});

describe("countBadgeClassName", () => {
	it("defaults to the neutral pill", () => {
		expect(countBadgeClassName(CountBadgeTone.Neutral)).toBe("bs-count-badge");
	});

	it("adds the accent modifier", () => {
		expect(countBadgeClassName(CountBadgeTone.Accent)).toBe("bs-count-badge bs-count-badge--accent");
	});

	it("appends extra classes", () => {
		expect(countBadgeClassName(CountBadgeTone.Neutral, "x")).toBe("bs-count-badge x");
	});
});

describe("createCountBadge", () => {
	it("builds a span carrying the count + data attr", () => {
		const el = createCountBadge(16);
		expect(el.tagName).toBe("SPAN");
		expect(el.className).toBe("bs-count-badge");
		expect(el.dataset.count).toBe("16");
		expect(el.textContent).toBe("16");
	});

	it("honours tone + cap", () => {
		const el = createCountBadge(140, { tone: CountBadgeTone.Accent, max: 99 });
		expect(el.className).toBe("bs-count-badge bs-count-badge--accent");
		expect(el.dataset.count).toBe("140");
		expect(el.textContent).toBe("99+");
	});
});
