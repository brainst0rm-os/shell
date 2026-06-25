import { describe, expect, it } from "vitest";
import { readIframeWidgetLaunch, widgetFrameOrigin, widgetIframeQuery } from "./iframe-bridge";

describe("readIframeWidgetLaunch", () => {
	it("parses the widget flag + id (+ optional bind) from the URL search", () => {
		expect(readIframeWidgetLaunch("?bs-widget=1&bs-widget-id=recent-notes")).toEqual({
			widgetId: "recent-notes",
		});
		expect(readIframeWidgetLaunch("?bs-widget=1&bs-widget-id=today-agenda&bs-bind=ent_1")).toEqual({
			widgetId: "today-agenda",
			bind: "ent_1",
		});
	});

	it("returns null without the flag or without an id", () => {
		expect(readIframeWidgetLaunch("")).toBeNull();
		expect(readIframeWidgetLaunch("?bs-widget=1")).toBeNull();
		expect(readIframeWidgetLaunch("?bs-widget-id=x")).toBeNull();
	});
});

describe("widgetFrameOrigin", () => {
	it("derives the frame's own origin from its src (the postMessage targetOrigin)", () => {
		expect(widgetFrameOrigin("https://example.com/widget/?v=abc")).toBe("https://example.com");
		expect(widgetFrameOrigin("http://localhost:5173/dist/index.html?bs-widget=1")).toBe(
			"http://localhost:5173",
		);
	});

	it("derives the real bswidget:// origin via protocol+host (its .origin is opaque)", () => {
		// The production case: a non-special scheme whose `URL.origin` is "null",
		// so the helper composes `protocol//host` to get a usable targetOrigin.
		expect(widgetFrameOrigin("bswidget://recent-notes/?v=abc1234")).toBe("bswidget://recent-notes");
	});

	it("falls back to the wildcard when the src can't be parsed (never drops messages)", () => {
		expect(widgetFrameOrigin("not a url")).toBe("*");
		expect(widgetFrameOrigin("")).toBe("*");
	});
});

describe("widgetIframeQuery", () => {
	it("round-trips a launch target through the URL query", () => {
		for (const launch of [{ widgetId: "open-tasks" }, { widgetId: "today-agenda", bind: "ent_9" }]) {
			expect(readIframeWidgetLaunch(`?${widgetIframeQuery(launch)}`)).toEqual(launch);
		}
	});
});
