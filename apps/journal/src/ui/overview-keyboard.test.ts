// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachOverviewKeyboard } from "./overview-keyboard";

afterEach(() => document.body.replaceChildren());

/** Reproduces `renderOverview()`'s DOM: a `listHost` wrapping per-month
 *  `<ul>`s of `.journal__overview-btn` rows with continuous composite indices,
 *  plus interleaved month `<h3>` headings (which carry no index). */
function buildOverview(months: string[][]): {
	listHost: HTMLElement;
	rows: HTMLButtonElement[];
} {
	const listHost = document.createElement("div");
	listHost.className = "journal__overview-lists";
	const rows: HTMLButtonElement[] = [];
	for (const month of months) {
		const heading = document.createElement("h3");
		heading.className = "journal__overview-month";
		heading.textContent = "Month";
		listHost.appendChild(heading);
		const list = document.createElement("ul");
		list.className = "journal__overview-list";
		for (const label of month) {
			const li = document.createElement("li");
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "journal__overview-btn";
			btn.dataset.compositeIndex = String(rows.length);
			btn.textContent = label;
			rows.push(btn);
			li.appendChild(btn);
			list.appendChild(li);
		}
		listHost.appendChild(list);
	}
	document.body.appendChild(listHost);
	return { listHost, rows };
}

describe("attachOverviewKeyboard", () => {
	it("stamps the listbox role on the host and option roles on the rows", () => {
		const { listHost, rows } = buildOverview([["a", "b"], ["c"]]);
		attachOverviewKeyboard(listHost, {
			count: () => rows.length,
			initialActiveIndex: 0,
			onOpen: vi.fn(),
		});
		expect(listHost.getAttribute("role")).toBe("listbox");
		for (const row of rows) expect(row.getAttribute("role")).toBe("option");
	});

	it("ArrowDown moves the roving cursor across month boundaries", () => {
		const { listHost, rows } = buildOverview([["a", "b"], ["c"]]);
		attachOverviewKeyboard(listHost, {
			count: () => rows.length,
			initialActiveIndex: 0,
			onOpen: vi.fn(),
		});
		expect(rows[0]?.tabIndex).toBe(0);
		listHost.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
		expect(rows[1]?.getAttribute("aria-selected")).toBe("true");
		expect(rows[1]?.tabIndex).toBe(0);
		// Cross the month boundary into the second `<ul>`.
		listHost.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
		expect(rows[2]?.getAttribute("aria-selected")).toBe("true");
	});

	it("Enter on the active row opens it", () => {
		const { listHost, rows } = buildOverview([["a", "b"]]);
		const onOpen = vi.fn();
		attachOverviewKeyboard(listHost, {
			count: () => rows.length,
			initialActiveIndex: 1,
			onOpen,
		});
		rows[1]?.focus();
		rows[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		expect(onOpen).toHaveBeenCalledTimes(1);
		expect(onOpen.mock.calls[0]?.[0]).toBe(1);
	});

	it("a negative initial index falls back to the first row", () => {
		const { listHost, rows } = buildOverview([["a", "b"]]);
		attachOverviewKeyboard(listHost, {
			count: () => rows.length,
			initialActiveIndex: -1,
			onOpen: vi.fn(),
		});
		expect(rows[0]?.getAttribute("aria-selected")).toBe("true");
	});
});
