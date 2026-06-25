// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flush, renderInto } from "../../test/render";
import { CalendarViewKind, WeekStartsOn } from "../../types/calendar-view";
import { CalendarHeaderActions, CalendarHeaderLead } from "./calendar-header";

let handle: Awaited<ReturnType<typeof renderInto>> | null = null;
afterEach(async () => {
	await handle?.unmount();
	handle = null;
	document.body.replaceChildren();
});

async function mount(viewKind: CalendarViewKind, onViewKind = vi.fn()) {
	handle = await renderInto(
		<CalendarHeaderActions
			viewKind={viewKind}
			onViewKind={onViewKind}
			onNewEvent={vi.fn()}
			onSearch={vi.fn()}
		/>,
	);
	return { onViewKind, c: handle.container };
}

describe("CalendarHeaderActions view tabs — KBN-A composite keyboard", () => {
	it("the tablist + tab roles come from the binding", async () => {
		const { c } = await mount(CalendarViewKind.Week);
		expect(c.querySelector(".cal-toolbar__tabs")?.getAttribute("role")).toBe("tablist");
		for (const btn of c.querySelectorAll(".cal-toolbar__tab")) {
			expect(btn.getAttribute("role")).toBe("tab");
		}
		void WeekStartsOn;
	});

	it("aria-selected reflects the active view kind", async () => {
		const { c } = await mount(CalendarViewKind.Day);
		expect(c.querySelector('.cal-toolbar__tab[data-view="day"]')?.getAttribute("aria-selected")).toBe(
			"true",
		);
		expect(
			c.querySelector('.cal-toolbar__tab[data-view="week"]')?.getAttribute("aria-selected"),
		).toBe("false");
	});

	it("the roving tabindex starts on the active view tab", async () => {
		const { c } = await mount(CalendarViewKind.Week);
		const week = c.querySelector<HTMLElement>('.cal-toolbar__tab[data-view="week"]');
		const day = c.querySelector<HTMLElement>('.cal-toolbar__tab[data-view="day"]');
		expect(week?.tabIndex).toBe(0);
		expect(day?.tabIndex).toBe(-1);
	});

	it("ArrowRight moves the cursor; Enter commits the next view kind", async () => {
		const { onViewKind, c } = await mount(CalendarViewKind.Week);
		const tabs = c.querySelector<HTMLElement>(".cal-toolbar__tabs");
		if (!tabs) throw new Error("no tabs");
		tabs.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
		await flush();
		const day = c.querySelector<HTMLElement>('.cal-toolbar__tab[data-view="day"]');
		expect(day?.tabIndex).toBe(0);
		tabs.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		await flush();
		expect(onViewKind).toHaveBeenCalledWith(CalendarViewKind.Day);
	});

	it("clicking a tab commits its view kind", async () => {
		const { onViewKind, c } = await mount(CalendarViewKind.Week);
		c.querySelector<HTMLButtonElement>('.cal-toolbar__tab[data-view="month"]')?.click();
		expect(onViewKind).toHaveBeenCalledWith(CalendarViewKind.Month);
	});
});

describe("CalendarHeaderLead — range title (F-220)", () => {
	it("the range heading carries the shared app-header title face", async () => {
		handle = await renderInto(
			<CalendarHeaderLead
				viewKind={CalendarViewKind.Month}
				anchor={Date.UTC(2026, 5, 11)}
				weekStartsOn={WeekStartsOn.Monday}
				onPrev={vi.fn()}
				onNext={vi.fn()}
				onToday={vi.fn()}
			/>,
		);
		const range = handle.container.querySelector("h1.cal-toolbar__range");
		expect(range).not.toBeNull();
		expect(range?.classList.contains("app-header__title")).toBe(true);
	});
});
