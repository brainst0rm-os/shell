// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { DiffViewMode, openDiffView } from "./diff-view";

const labels = {
	title: (name: string) => `Changes in ${name}`,
	close: "Close diff",
	stats: ({ added, removed }: { added: string; removed: string }) => `+${added} -${removed}`,
	noChanges: "No changes",
	baseColumn: "Saved",
	nextColumn: "Current",
};

function mount(): HTMLElement {
	const el = document.createElement("div");
	document.body.appendChild(el);
	return el;
}

describe("openDiffView", () => {
	it("shows a no-changes state when the buffer matches the baseline", () => {
		const m = mount();
		openDiffView({
			fileName: "a.ts",
			baseline: "a\nb",
			current: "a\nb",
			mode: DiffViewMode.SideBySide,
			mount: m,
			labels,
		});
		expect(m.querySelector(".editor__diff-empty")?.textContent).toBe("No changes");
		expect(m.querySelector(".editor__diff-row")).toBeNull();
	});

	it("renders the file name + stats in the header", () => {
		const m = mount();
		openDiffView({
			fileName: "a.ts",
			baseline: "a\nb\nc",
			current: "a\nB\nc\nd",
			mode: DiffViewMode.Unified,
			mount: m,
			labels,
		});
		expect(m.querySelector(".editor__diff-title")?.textContent).toBe("Changes in a.ts");
		// one modify (1 add + 1 remove) + one append (1 add) = +2 -1
		expect(m.querySelector(".editor__diff-stats")?.textContent).toBe("+2 -1");
	});

	it("unified mode renders one row per diff line with add/remove classes", () => {
		const m = mount();
		openDiffView({
			fileName: "a.ts",
			baseline: "a\nb",
			current: "a\nB",
			mode: DiffViewMode.Unified,
			mount: m,
			labels,
		});
		expect(m.querySelector(".editor__diff-body--unified")).not.toBeNull();
		expect(m.querySelector(".editor__diff-row--removed")).not.toBeNull();
		expect(m.querySelector(".editor__diff-row--added")).not.toBeNull();
		expect(m.querySelector(".editor__diff-columns")).toBeNull();
	});

	it("side-by-side mode renders two column heads + empty halves for adds/removes", () => {
		const m = mount();
		openDiffView({
			fileName: "a.ts",
			baseline: "a\nb",
			current: "a\nc",
			mode: DiffViewMode.SideBySide,
			mount: m,
			labels,
		});
		expect(m.querySelector(".editor__diff-body--side-by-side")).not.toBeNull();
		expect(m.querySelectorAll(".editor__diff-colhead")).toHaveLength(2);
		// the removed base line has an empty right half; the added next line an empty left
		expect(m.querySelector(".editor__diff-side--empty")).not.toBeNull();
	});

	it("close button tears down + fires onClose", () => {
		const m = mount();
		const onClose = vi.fn();
		const controller = openDiffView({
			fileName: "a.ts",
			baseline: "a",
			current: "b",
			mode: DiffViewMode.Unified,
			mount: m,
			labels,
			onClose,
		});
		m.querySelector<HTMLButtonElement>(".editor__diff-close")?.click();
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(m.querySelector(".editor__diff-overlay")).toBeNull();
		// idempotent
		controller.close();
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("backdrop click closes", () => {
		const m = mount();
		const onClose = vi.fn();
		openDiffView({
			fileName: "a.ts",
			baseline: "a",
			current: "b",
			mode: DiffViewMode.Unified,
			mount: m,
			labels,
			onClose,
		});
		const overlay = m.querySelector<HTMLElement>(".editor__diff-overlay");
		overlay?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
