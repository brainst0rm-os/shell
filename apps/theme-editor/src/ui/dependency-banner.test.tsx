import { act } from "react";
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ThemeSlot } from "../logic/dependencies";
import { renderInto } from "../test/render";
import { DependencyBanner } from "./dependency-banner";

const t = (key: string) => key;

describe("DependencyBanner", () => {
	it("renders nothing when nothing is missing", async () => {
		const { container, unmount } = await renderInto(
			<DependencyBanner missing={[]} t={t} onReset={vi.fn()} />,
		);
		expect(container.querySelector(".te-banner")).toBeNull();
		await unmount();
	});

	it("lists one reset row per missing slot", async () => {
		const { container, unmount } = await renderInto(
			<DependencyBanner
				missing={[
					{ slot: ThemeSlot.TokenSet, entityId: "a" },
					{ slot: ThemeSlot.IconPack, entityId: "b" },
				]}
				t={t}
				onReset={vi.fn()}
			/>,
		);
		expect(container.querySelectorAll(".te-banner__row")).toHaveLength(2);
		await unmount();
	});

	it("reports the slot on reset", async () => {
		const onReset = vi.fn();
		const { container, unmount } = await renderInto(
			<DependencyBanner
				missing={[{ slot: ThemeSlot.Typography, entityId: "t" }]}
				t={t}
				onReset={onReset}
			/>,
		);
		await act(async () => {
			container.querySelector<HTMLButtonElement>(".te-banner__reset")?.click();
		});
		expect(onReset).toHaveBeenCalledWith(ThemeSlot.Typography);
		await unmount();
	});
});
