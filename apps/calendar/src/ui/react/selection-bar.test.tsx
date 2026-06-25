// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flush, renderInto } from "../../test/render";
import { SelectionBar } from "./selection-bar";

let handle: Awaited<ReturnType<typeof renderInto>> | null = null;
afterEach(async () => {
	await handle?.unmount();
	handle = null;
	document.body.replaceChildren();
});

describe("SelectionBar", () => {
	it("shows the count and wires the actions", async () => {
		const onReschedule = vi.fn();
		const onClear = vi.fn();
		handle = await renderInto(
			<SelectionBar count={3} onReschedule={onReschedule} onClear={onClear} />,
		);
		const c = handle.container;
		expect(c.querySelector(".cal-selection-bar__count")?.textContent).toContain("3");

		c.querySelector<HTMLButtonElement>(".cal-selection-bar__action")?.click();
		expect(onReschedule).toHaveBeenCalledTimes(1);
		c.querySelector<HTMLButtonElement>(".cal-selection-bar__action--ghost")?.click();
		expect(onClear).toHaveBeenCalledTimes(1);
	});

	it("the toolbar role + composite indices come from the binding", async () => {
		handle = await renderInto(<SelectionBar count={3} onReschedule={vi.fn()} onClear={vi.fn()} />);
		const bar = handle.container.querySelector<HTMLElement>(".cal-selection-bar");
		expect(bar?.getAttribute("role")).toBe("toolbar");
		const reschedule = handle.container.querySelector<HTMLElement>(".cal-selection-bar__action");
		const count = handle.container.querySelector<HTMLElement>(".cal-selection-bar__count");
		expect(reschedule?.dataset.compositeIndex).toBe("0");
		expect(count?.dataset.compositeIndex).toBeUndefined();
	});

	it("the roving cursor starts on the first action; ArrowRight roves", async () => {
		handle = await renderInto(<SelectionBar count={3} onReschedule={vi.fn()} onClear={vi.fn()} />);
		const bar = handle.container.querySelector<HTMLElement>(".cal-selection-bar");
		if (!bar) throw new Error("no bar");
		const actions = handle.container.querySelectorAll<HTMLElement>(".cal-selection-bar__action");
		expect(actions[0]?.tabIndex).toBe(0);
		expect(actions[1]?.tabIndex).toBe(-1);
		bar.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
		await flush();
		expect(actions[1]?.tabIndex).toBe(0);
		expect(actions[0]?.tabIndex).toBe(-1);
	});
});
