import { describe, expect, it } from "vitest";
import { WEB_VIEW_DEFAULT_BACKGROUND, WebViewBackgroundController } from "./web-view-background";

const THEME = "#0a1020";

describe("WebViewBackgroundController", () => {
	it("starts on the web-default white", () => {
		expect(new WebViewBackgroundController().backgroundColor).toBe(WEB_VIEW_DEFAULT_BACKGROUND);
	});

	it("paints the theme color on the empty surface once it resolves", () => {
		const c = new WebViewBackgroundController();
		c.onThemeResolved(THEME);
		expect(c.backgroundColor).toBe(THEME);
	});

	it("ignores a null theme resolve (white stands)", () => {
		const c = new WebViewBackgroundController();
		c.onThemeResolved(null);
		expect(c.backgroundColor).toBe(WEB_VIEW_DEFAULT_BACKGROUND);
	});

	it("reverts to white when navigating to a real page", () => {
		const c = new WebViewBackgroundController();
		c.onThemeResolved(THEME);
		c.onNavigationStart("https://www.linkedin.com/");
		expect(c.backgroundColor).toBe(WEB_VIEW_DEFAULT_BACKGROUND);
	});

	// The bleed-through race: navigation to a real page starts, THEN the theme
	// color resolves. A URL-only check (getURL still reports about:blank pre-commit)
	// would re-paint the theme color under the page. The flag must suppress it.
	it("does NOT re-paint the theme color when it resolves after navigation starts", () => {
		const c = new WebViewBackgroundController();
		c.onNavigationStart("https://www.linkedin.com/");
		c.onThemeResolved(THEME);
		expect(c.backgroundColor).toBe(WEB_VIEW_DEFAULT_BACKGROUND);
	});

	it("restores the theme color when returning to the new-tab empty surface", () => {
		const c = new WebViewBackgroundController();
		c.onThemeResolved(THEME);
		c.onNavigationStart("https://www.linkedin.com/");
		c.onNavigationStart("about:blank");
		expect(c.backgroundColor).toBe(THEME);
	});

	it("keeps white on the new tab if the theme never resolves", () => {
		const c = new WebViewBackgroundController();
		c.onNavigationStart("about:blank");
		expect(c.backgroundColor).toBe(WEB_VIEW_DEFAULT_BACKGROUND);
	});
});
