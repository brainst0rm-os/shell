// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { EVENT_SOURCE_KEY, type ScheduledItem } from "../../logic/scheduled-item";
import { flush, renderInto } from "../../test/render";
import { SearchOverlay } from "./search-overlay";

const NOW = new Date(2026, 4, 14, 12, 0, 0).getTime();

function item(id: string, title: string): ScheduledItem {
	return {
		id,
		sourceKey: EVENT_SOURCE_KEY,
		sourceEntityId: id,
		title,
		icon: null,
		start: NOW + 3_600_000,
		end: null,
		allDay: false,
		location: null,
		recurrence: null,
		colorHint: null,
	};
}

let handle: Awaited<ReturnType<typeof renderInto>> | null = null;
afterEach(async () => {
	await handle?.unmount();
	handle = null;
	document.body.replaceChildren();
});

async function type(input: HTMLInputElement, value: string): Promise<void> {
	const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
	setter?.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
	await flush();
}

describe("SearchOverlay", () => {
	it("filters live as the user types and shows a hint when empty", async () => {
		handle = await renderInto(
			<SearchOverlay
				getItems={() => [item("a", "Standup"), item("b", "Lunch")]}
				now={NOW}
				onPick={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		const input = document.querySelector<HTMLInputElement>(".cal-search__input");
		if (!input) throw new Error("no search input");
		expect(document.querySelector<HTMLElement>(".cal-search__status")?.hidden).toBe(false);

		await type(input, "stand");
		const rows = document.querySelectorAll(".cal-search__row");
		expect(rows).toHaveLength(1);
		expect(rows[0]?.querySelector(".cal-search__title")?.textContent).toBe("Standup");
	});

	it("Enter picks the active row and closes", async () => {
		const onPick = vi.fn();
		const onClose = vi.fn();
		handle = await renderInto(
			<SearchOverlay
				getItems={() => [item("a", "Standup")]}
				now={NOW}
				onPick={onPick}
				onClose={onClose}
			/>,
		);
		const input = document.querySelector<HTMLInputElement>(".cal-search__input");
		if (!input) throw new Error("no input");
		await type(input, "stand");
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		await flush();
		expect(onPick).toHaveBeenCalledTimes(1);
		expect(onPick.mock.calls[0]?.[0]?.id).toBe("a");
	});

	it("clicking a result picks it", async () => {
		const onPick = vi.fn();
		handle = await renderInto(
			<SearchOverlay
				getItems={() => [item("a", "Standup"), item("b", "Standby")]}
				now={NOW}
				onPick={onPick}
				onClose={vi.fn()}
			/>,
		);
		const input = document.querySelector<HTMLInputElement>(".cal-search__input");
		if (!input) throw new Error("no input");
		await type(input, "stand");
		document.querySelectorAll<HTMLButtonElement>(".cal-search__row")[1]?.click();
		expect(onPick).toHaveBeenCalledTimes(1);
		expect(onPick.mock.calls[0]?.[0]?.title).toBe("Standby");
	});

	it("KBN-A: results form a combobox listbox driven from the input", async () => {
		handle = await renderInto(
			<SearchOverlay
				getItems={() => [item("a", "Standup"), item("b", "Standby")]}
				now={NOW}
				onPick={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		const input = document.querySelector<HTMLInputElement>(".cal-search__input");
		if (!input) throw new Error("no input");
		await type(input, "stand");
		const list = document.querySelector<HTMLElement>(".cal-search__results");
		const rows = document.querySelectorAll<HTMLElement>(".cal-search__row");
		expect(list?.getAttribute("role")).toBe("listbox");
		expect(rows[0]?.getAttribute("role")).toBe("option");
		expect(input.getAttribute("aria-activedescendant")).toBe(rows[0]?.id);
		expect(rows[0]?.dataset.active).toBe("true");

		input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
		await flush();
		expect(input.getAttribute("aria-activedescendant")).toBe(rows[1]?.id);
		expect(rows[1]?.dataset.active).toBe("true");
		expect(rows[1]?.getAttribute("aria-selected")).toBe("true");
	});
});
