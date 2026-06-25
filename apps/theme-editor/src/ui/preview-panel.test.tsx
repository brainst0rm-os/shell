// @vitest-environment jsdom
import { createRef } from "react";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { renderInto } from "../test/render";
import { PreviewPanel } from "./preview-panel";

const t = (key: string) => key;

describe("PreviewPanel", () => {
	it("renders the app tiles + the sample window and exposes the preview ref", async () => {
		const ref = createRef<HTMLElement>();
		const { container, unmount } = await renderInto(<PreviewPanel t={t} previewRef={ref} />);
		expect(container.querySelectorAll(".te-mini-tile").length).toBeGreaterThanOrEqual(5);
		expect(container.querySelector(".te-mini-window")).toBeTruthy();
		expect(ref.current).toBe(container.querySelector(".te-preview"));
		await unmount();
	});

	it("switches the sample window when another app tile is clicked", async () => {
		const ref = createRef<HTMLElement>();
		const { container, unmount } = await renderInto(<PreviewPanel t={t} previewRef={ref} />);
		const titleBefore = container.querySelector(".te-mini-doc__title")?.textContent;
		const tiles = container.querySelectorAll<HTMLButtonElement>(".te-mini-tile");
		await act(async () => {
			tiles[1]?.click(); // Tasks
		});
		const active = container.querySelector(".te-mini-tile--active");
		expect(active).toBe(tiles[1]);
		expect(container.querySelector(".te-mini-doc__title")?.textContent).not.toBe(titleBefore);
		await unmount();
	});
});
