/**
 * @vitest-environment jsdom
 *
 * Boot smoke test — renders the real `<PreviewApp />` under a barebones DOM
 * with no `window.brainstorm`, asserting no render crash (TDZ /
 * ReferenceError) and that the honest empty state paints. Closes the
 * pipeline gap that let a boot crash ship.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import { PreviewApp } from "../src/app";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("preview app boots without a render crash", () => {
	beforeEach(() => {
		(window as { brainstorm?: unknown }).brainstorm = undefined;
		if (!("ResizeObserver" in window)) {
			(window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
				observe() {}
				unobserve() {}
				disconnect() {}
			};
		}
		if (!window.matchMedia) {
			(window as unknown as { matchMedia: unknown }).matchMedia = () => ({
				matches: false,
				addEventListener() {},
				removeEventListener() {},
			});
		}
	});

	it("renders the empty state with no runtime present", async () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		await act(async () => {
			root.render(<PreviewApp />);
		});
		expect(container.querySelector(".bs-empty-state")).not.toBeNull();
		expect(container.querySelector('[data-testid="app-header"]')).not.toBeNull();
		await act(async () => root.unmount());
		container.remove();
	});
});
