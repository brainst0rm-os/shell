// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { collectBlockThemeVars } from "./collect-theme";

function addStyle(css: string): HTMLStyleElement {
	const el = document.createElement("style");
	el.textContent = css;
	document.head.appendChild(el);
	return el;
}

describe("collectBlockThemeVars", () => {
	afterEach(() => {
		for (const el of document.head.querySelectorAll("style")) el.remove();
		document.documentElement.removeAttribute("style");
	});

	it("harvests stylesheet-declared tokens by computed value (the F-210 gap)", () => {
		addStyle(":root { --color-background-primary: #0a1020; --color-text-primary: #e7eef9; }");
		const { vars } = collectBlockThemeVars(window);
		expect(vars["--color-background-primary"]).toBe("#0a1020");
		expect(vars["--color-text-primary"]).toBe("#e7eef9");
	});

	it("still includes inline vars and lets the cascade win", () => {
		addStyle(":root { --color-background-primary: #ffffff; }");
		document.documentElement.style.setProperty("--app-header-height", "44px");
		document.documentElement.style.setProperty("--color-background-primary", "#0a1020");
		const { vars } = collectBlockThemeVars(window);
		expect(vars["--app-header-height"]).toBe("44px");
		expect(vars["--color-background-primary"]).toBe("#0a1020");
	});

	it("resolves a dark scheme from a dark primary background", () => {
		addStyle(":root { --color-background-primary: #0a1020; }");
		expect(collectBlockThemeVars(window).colorScheme).toBe("dark");
	});

	it("resolves a light scheme from a light primary background", () => {
		addStyle(":root { --color-background-primary: #f5f7fb; }");
		expect(collectBlockThemeVars(window).colorScheme).toBe("light");
	});

	it("falls back to the computed color-scheme when the background is unparseable", () => {
		const { colorScheme } = collectBlockThemeVars(window);
		expect(typeof colorScheme).toBe("string");
		expect(colorScheme.length).toBeGreaterThan(0);
	});
});
