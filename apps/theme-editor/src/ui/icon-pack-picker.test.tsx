// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { BUILTIN_CHOICE_KEY, iconPackChoices } from "../logic/icon-pack-options";
import { renderInto } from "../test/render";
import { IconPackPicker } from "./icon-pack-picker";

const t = (key: string) => key;

describe("IconPackPicker", () => {
	it("renders one radio per choice and marks the selected one", async () => {
		const choices = iconPackChoices([{ id: "p1", name: "Hand-drawn" }]);
		const { container, unmount } = await renderInto(
			<IconPackPicker choices={choices} selectedKey="p1" t={t} onSelect={vi.fn()} />,
		);
		const radios = container.querySelectorAll<HTMLButtonElement>(".te-pack");
		expect(radios).toHaveLength(2);
		const selected = [...radios].filter((r) => r.getAttribute("aria-checked") === "true");
		expect(selected).toHaveLength(1);
		expect(selected[0]?.classList.contains("te-pack--selected")).toBe(true);
		await unmount();
	});

	it("reports the chosen key on click", async () => {
		const onSelect = vi.fn();
		const choices = iconPackChoices([{ id: "p1", name: "Hand-drawn" }]);
		const { container, unmount } = await renderInto(
			<IconPackPicker choices={choices} selectedKey={BUILTIN_CHOICE_KEY} t={t} onSelect={onSelect} />,
		);
		await act(async () => {
			container.querySelectorAll<HTMLButtonElement>(".te-pack")[1]?.click();
		});
		expect(onSelect).toHaveBeenCalledWith("p1");
		await unmount();
	});

	it("shows the empty hint when only the built-in is available", async () => {
		const { container, unmount } = await renderInto(
			<IconPackPicker
				choices={iconPackChoices([])}
				selectedKey={BUILTIN_CHOICE_KEY}
				t={t}
				onSelect={vi.fn()}
			/>,
		);
		expect(container.querySelector(".te-packs__hint")).toBeTruthy();
		await unmount();
	});

	// KBN-A-theme-editor — roving-tabindex radiogroup (focus-then-commit).
	it("stamps a radiogroup with radio rows and roving tabindex on the selected pack", async () => {
		const choices = iconPackChoices([{ id: "p1", name: "Hand-drawn" }]);
		const { container, unmount } = await renderInto(
			<IconPackPicker choices={choices} selectedKey="p1" t={t} onSelect={vi.fn()} />,
		);
		const group = container.querySelector(".te-packs");
		expect(group?.getAttribute("role")).toBe("radiogroup");
		const radios = container.querySelectorAll<HTMLButtonElement>(".te-pack");
		expect([...radios].every((r) => r.getAttribute("role") === "radio")).toBe(true);
		// 'p1' is index 1 (built-in is 0) → it's the cursor → tabindex 0.
		expect(radios[1]?.tabIndex).toBe(0);
		expect(radios[0]?.tabIndex).toBe(-1);
		await unmount();
	});

	it("ArrowDown roves focus without committing; Enter commits the focused pack", async () => {
		const onSelect = vi.fn();
		const choices = iconPackChoices([{ id: "p1", name: "Hand-drawn" }]);
		// Built-in selected (index 0) → cursor starts at 0.
		const { container, unmount } = await renderInto(
			<IconPackPicker choices={choices} selectedKey={BUILTIN_CHOICE_KEY} t={t} onSelect={onSelect} />,
		);
		const first = container.querySelectorAll<HTMLButtonElement>(".te-pack")[0];
		await act(async () => {
			first?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
		});
		// Arrow alone does NOT select (no app re-render thrash).
		expect(onSelect).not.toHaveBeenCalled();
		// Enter commits the now-focused pack (index 1 = 'p1').
		const second = container.querySelectorAll<HTMLButtonElement>(".te-pack")[1];
		await act(async () => {
			second?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		});
		expect(onSelect).toHaveBeenCalledWith("p1");
		await unmount();
	});
});
