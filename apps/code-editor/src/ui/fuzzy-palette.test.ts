// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { openFuzzyPalette } from "./fuzzy-palette";

type Item = { id: string; label: string };

const LABELS = { label: "Palette", placeholder: "Type…", empty: "No matches" };

const passthroughRank = (rows: readonly Item[], query: string): Item[] =>
	query.trim() === "" ? [...rows] : rows.filter((r) => r.label.includes(query));

afterEach(() => document.body.replaceChildren());

function mount(opts: {
	rows: Item[];
	onChoose?: (row: Item) => void;
	renderRow?: (li: HTMLElement, row: Item) => void;
	onClose?: () => void;
}) {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const controller = openFuzzyPalette<Item>({
		rows: opts.rows,
		mount: host,
		rank: passthroughRank,
		renderRow:
			opts.renderRow ??
			((li, row) => {
				li.dataset.itemId = row.id;
				const name = document.createElement("span");
				name.className = "editor__quickopen-name";
				name.textContent = row.label;
				li.appendChild(name);
			}),
		onChoose: opts.onChoose ?? vi.fn(),
		labels: LABELS,
		...(opts.onClose ? { onClose: opts.onClose } : {}),
	});
	const input = host.querySelector<HTMLInputElement>(".editor__quickopen-input");
	const list = host.querySelector<HTMLElement>(".editor__quickopen-list");
	if (!input || !list) throw new Error("palette did not mount");
	return { host, controller, input, list };
}

function typeInto(input: HTMLInputElement, value: string): void {
	input.value = value;
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("openFuzzyPalette", () => {
	it("mounts a combobox listbox driven from the input", () => {
		const { input, list } = mount({
			rows: [
				{ id: "a", label: "Alpha" },
				{ id: "b", label: "Beta" },
			],
		});
		const rows = list.querySelectorAll<HTMLElement>(".editor__quickopen-item");
		expect(rows).toHaveLength(2);
		expect(list.getAttribute("role")).toBe("listbox");
		expect(rows[0]?.getAttribute("role")).toBe("option");
		expect(input.getAttribute("aria-activedescendant")).toBe(rows[0]?.id);
		expect(rows[0]?.dataset.active).toBe("true");
	});

	it("filters live and fires onChoose with the chosen row", () => {
		const onChoose = vi.fn();
		const { input, list, host } = mount({
			rows: [
				{ id: "a", label: "Alpha" },
				{ id: "b", label: "Beta" },
			],
			onChoose,
		});
		typeInto(input, "Beta");
		const rows = list.querySelectorAll<HTMLElement>(".editor__quickopen-item");
		expect(rows).toHaveLength(1);
		rows[0]?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		expect(onChoose).toHaveBeenCalledTimes(1);
		expect(onChoose.mock.calls[0]?.[0]).toEqual({ id: "b", label: "Beta" });
		// Choosing tears the overlay down.
		expect(host.querySelector(".editor__quickopen-overlay")).toBeNull();
	});

	it("renders the optional path span only when the row adapter adds it", () => {
		const withPath = mount({
			rows: [{ id: "a", label: "Alpha" }],
			renderRow: (li, row) => {
				const name = document.createElement("span");
				name.className = "editor__quickopen-name";
				name.textContent = row.label;
				const path = document.createElement("span");
				path.className = "editor__quickopen-path";
				path.textContent = `src/${row.id}.ts`;
				li.append(name, path);
			},
		});
		expect(withPath.list.querySelector(".editor__quickopen-path")?.textContent).toBe("src/a.ts");
		document.body.replaceChildren();

		const noPath = mount({ rows: [{ id: "a", label: "Alpha" }] });
		expect(noPath.list.querySelector(".editor__quickopen-path")).toBeNull();
	});

	it("shows the empty state when nothing matches", () => {
		const { input, list } = mount({ rows: [{ id: "a", label: "Alpha" }] });
		typeInto(input, "zzzz");
		expect(list.querySelectorAll(".editor__quickopen-item")).toHaveLength(0);
		expect(list.querySelector(".editor__quickopen-empty")?.textContent).toBe("No matches");
	});

	it("Escape closes and fires onClose", () => {
		const onClose = vi.fn();
		const { input, host } = mount({ rows: [{ id: "a", label: "Alpha" }], onClose });
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		expect(host.querySelector(".editor__quickopen-overlay")).toBeNull();
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
