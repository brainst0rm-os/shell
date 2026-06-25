/**
 * @vitest-environment jsdom
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
	APP_ICON_CACHE_KEY,
	appHasIcon,
	appIconVersion,
	appIconsKnown,
	resolveAppIconSrc,
	setAppIcons,
} from "./app-icon-cache";

beforeAll(() => {
	// The module reads `window.brainstorm.apps.iconUrl` when resolving a src.
	Object.defineProperty(window, "brainstorm", {
		configurable: true,
		value: {
			apps: {
				iconUrl: (appId: string, version?: string): string =>
					version ? `brainstorm://app-icon/${appId}?v=${version}` : `brainstorm://app-icon/${appId}`,
			},
		},
	});
});

describe("app-icon cache", () => {
	// Module state starts cold (nothing persisted at import) — this case can
	// only be observed before the first `setAppIcons`, so it runs first.
	it("renders optimistically before the first authoritative list", () => {
		expect(appIconsKnown()).toBe(false);
		expect(resolveAppIconSrc("com.example.app")).toBe("brainstorm://app-icon/com.example.app");
	});

	it("resolves a versioned, cacheable URL for an app that ships an icon", () => {
		const changed = setAppIcons([{ id: "com.example.app", hasIcon: true, version: "1.2.0" }]);
		expect(changed).toBe(true);
		expect(appIconsKnown()).toBe(true);
		expect(appHasIcon("com.example.app")).toBe(true);
		expect(appIconVersion("com.example.app")).toBe("1.2.0");
		expect(resolveAppIconSrc("com.example.app")).toBe(
			"brainstorm://app-icon/com.example.app?v=1.2.0",
		);
	});

	it("suppresses the request for a known icon-less app", () => {
		setAppIcons([{ id: "com.example.plain", hasIcon: false, version: "1.0.0" }]);
		expect(appHasIcon("com.example.plain")).toBe(false);
		expect(resolveAppIconSrc("com.example.plain")).toBeNull();
	});

	it("persists the version map to localStorage", () => {
		setAppIcons([{ id: "com.example.persist", hasIcon: true, version: "3.0.0" }]);
		const raw = window.localStorage.getItem(APP_ICON_CACHE_KEY);
		expect(raw).not.toBeNull();
		expect(JSON.parse(raw ?? "{}")).toEqual({ "com.example.persist": "3.0.0" });
	});

	it("reports no change when the list is identical", () => {
		setAppIcons([{ id: "com.example.same", hasIcon: true, version: "1.0.0" }]);
		const changed = setAppIcons([{ id: "com.example.same", hasIcon: true, version: "1.0.0" }]);
		expect(changed).toBe(false);
	});

	it("reports a change when a version bumps", () => {
		setAppIcons([{ id: "com.example.bump", hasIcon: true, version: "1.0.0" }]);
		const changed = setAppIcons([{ id: "com.example.bump", hasIcon: true, version: "2.0.0" }]);
		expect(changed).toBe(true);
		expect(resolveAppIconSrc("com.example.bump")).toBe(
			"brainstorm://app-icon/com.example.bump?v=2.0.0",
		);
	});
});
