/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DashboardWallpaper } from "../../preload";
import { WALLPAPER_CACHE_KEY, readCachedWallpaper, writeCachedWallpaper } from "./wallpaper-layer";

beforeEach(() => {
	window.localStorage.clear();
});

afterEach(() => {
	window.localStorage.clear();
});

describe("wallpaper cache", () => {
	it("round-trips a wallpaper through localStorage", () => {
		const wallpaper: DashboardWallpaper = { kind: "image", value: "brainstorm://wallpaper/x.png" };
		writeCachedWallpaper(wallpaper);
		expect(readCachedWallpaper()).toEqual(wallpaper);
	});

	it("returns null when nothing is cached", () => {
		expect(readCachedWallpaper()).toBeNull();
	});

	it("returns null for a malformed cache entry", () => {
		window.localStorage.setItem(WALLPAPER_CACHE_KEY, "{not json");
		expect(readCachedWallpaper()).toBeNull();
	});

	it("rejects a cache entry with an unknown kind", () => {
		window.localStorage.setItem(WALLPAPER_CACHE_KEY, JSON.stringify({ kind: "video", value: "x" }));
		expect(readCachedWallpaper()).toBeNull();
	});

	it("rejects a cache entry with a non-string value", () => {
		window.localStorage.setItem(WALLPAPER_CACHE_KEY, JSON.stringify({ kind: "solid", value: 42 }));
		expect(readCachedWallpaper()).toBeNull();
	});

	it("accepts every valid kind", () => {
		for (const kind of ["solid", "gradient", "image"] as const) {
			writeCachedWallpaper({ kind, value: "v" });
			expect(readCachedWallpaper()).toEqual({ kind, value: "v" });
		}
	});
});
