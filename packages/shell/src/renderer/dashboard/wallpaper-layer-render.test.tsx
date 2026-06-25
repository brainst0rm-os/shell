// @vitest-environment jsdom
/**
 * The full-res wallpaper `<img>` fades in via `onLoad`, but a browser-cached
 * image (vault re-entry / post-unlock) can already be `complete` before React
 * attaches the listener, so `onLoad` never fires. The mount effect reconciles
 * against the live `complete` flag so the layer can't get stuck invisible.
 */
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardWallpaper } from "../../preload";
import { WallpaperLayer } from "./wallpaper-layer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

const IMAGE: DashboardWallpaper = { kind: "image", value: "brainstorm://wallpaper/x.png" };

describe("WallpaperLayer cached-image reconcile", () => {
	it("marks an already-complete image ready on mount even when onLoad never fires", () => {
		// Simulate a cached image: `complete` is already true before React's
		// listener attaches, so the onLoad event will never arrive.
		vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);

		act(() => root.render(<WallpaperLayer wallpaper={IMAGE} />));

		const img = container.querySelector(".dashboard__wallpaper-image");
		expect(img?.getAttribute("data-ready")).toBe("true");
	});

	it("stays not-ready for an image still loading (complete=false, awaits onLoad)", () => {
		vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(false);

		act(() => root.render(<WallpaperLayer wallpaper={IMAGE} />));

		const img = container.querySelector(".dashboard__wallpaper-image");
		expect(img?.getAttribute("data-ready")).toBe("false");
	});
});
