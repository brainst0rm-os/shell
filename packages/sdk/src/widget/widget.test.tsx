// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WidgetRoot, getWidgetLaunch, onWidgetVisibility } from "./index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("getWidgetLaunch", () => {
	it("returns the target for a widget launch", () => {
		expect(
			getWidgetLaunch({ launch: { reason: "widget", widgetId: "recent", bind: "ent_1" } }),
		).toEqual({ widgetId: "recent", bind: "ent_1" });
	});

	it("omits bind when absent", () => {
		expect(getWidgetLaunch({ launch: { reason: "widget", widgetId: "recent" } })).toEqual({
			widgetId: "recent",
		});
	});

	it("returns null for a non-widget launch", () => {
		expect(getWidgetLaunch({ launch: { reason: "fresh" } })).toBeNull();
		expect(getWidgetLaunch({ launch: { reason: "widget" } })).toBeNull(); // no widgetId
		expect(getWidgetLaunch({})).toBeNull();
	});
});

describe("onWidgetVisibility", () => {
	afterEach(() => {
		delete document.documentElement.dataset.appHidden;
	});

	it("fires immediately, then on the shell's app-visibility pause edge", () => {
		const seen: boolean[] = [];
		const off = onWidgetVisibility((v) => seen.push(v));
		// No appHidden flag yet → visible.
		expect(seen).toEqual([true]);
		// The shell hides the native view: app-preload sets the flag + fires the event.
		document.documentElement.dataset.appHidden = "true";
		window.dispatchEvent(
			new CustomEvent("brainstorm:app-visibility", { detail: { visible: false } }),
		);
		expect(seen).toEqual([true, false]);
		// Resume.
		document.documentElement.dataset.appHidden = "false";
		window.dispatchEvent(new CustomEvent("brainstorm:app-visibility", { detail: { visible: true } }));
		expect(seen).toEqual([true, false, true]);
		off();
		window.dispatchEvent(
			new CustomEvent("brainstorm:app-visibility", { detail: { visible: false } }),
		);
		expect(seen).toEqual([true, false, true]); // unsubscribed
	});

	it("also honours a genuine Page Visibility flip", () => {
		const seen: boolean[] = [];
		const off = onWidgetVisibility((v) => seen.push(v));
		document.documentElement.dataset.appHidden = "true";
		document.dispatchEvent(new Event("visibilitychange"));
		expect(seen).toEqual([true, false]);
		off();
	});
});

describe("WidgetRoot", () => {
	let host: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
	});
	afterEach(() => {
		act(() => root.unmount());
		host.remove();
	});

	const widgets = [
		{ id: "recent", render: () => <p className="w-recent">recent body</p> },
		{ id: "agenda", render: () => <p className="w-agenda">agenda body</p> },
	];

	it("renders only the matched widget's body (chrome lives in the shell strip)", () => {
		act(() => {
			root.render(<WidgetRoot widgets={widgets} launch={{ widgetId: "agenda" }} />);
		});
		expect(document.querySelector(".w-agenda")?.textContent).toBe("agenda body");
		expect(document.querySelector(".w-recent")).toBeNull();
		// No title / open chrome — the renderer DashboardWidgetsLayer owns it.
		expect(document.querySelector(".bs-widget__title")).toBeNull();
		expect(document.querySelector(".bs-widget__open")).toBeNull();
	});

	it("falls back gracefully for an unknown widget id", () => {
		act(() => {
			root.render(<WidgetRoot widgets={widgets} launch={{ widgetId: "nope" }} />);
		});
		expect(document.querySelector(".bs-widget__missing")?.textContent).toContain("nope");
	});
});
