/**
 * @vitest-environment jsdom
 *
 * Source picker — the UI that lets "New list" pick which object types it
 * shows (the fix for "you can't pick objects to display"). Guards two
 * seams: the shared `buildTypeChecklist` renders one toggle row per type
 * and reports toggles, and `openSourcePicker` only enables Create once at
 * least one type is checked, then hands back the selected type ids.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import {
	type SourceTypeOption,
	buildTypeChecklist,
	closeSourcePicker,
	openSourcePicker,
} from "./source-picker";

const TYPES: SourceTypeOption[] = [
	{ type: "brainstorm/Task/v1", label: "Tasks", count: 12 },
	{ type: "brainstorm/Note/v1", label: "Notes", count: 5 },
	{ type: "brainstorm/Person/v1", label: "People", count: 3 },
];

afterEach(() => {
	closeSourcePicker();
	document.body.replaceChildren();
});

describe("buildTypeChecklist", () => {
	test("renders one row per type with its label + count", () => {
		const el = buildTypeChecklist({ types: TYPES, selected: new Set(), onToggle: () => {} });
		const names = [...el.querySelectorAll(".db-source__name")].map((n) => n.textContent);
		expect(names).toEqual(["Tasks", "Notes", "People"]);
		const counts = [...el.querySelectorAll(".db-source__count")].map((n) => n.textContent);
		expect(counts).toEqual(["12", "5", "3"]);
	});

	test("reflects the selected set and reports toggles", () => {
		const onToggle = vi.fn();
		const el = buildTypeChecklist({
			types: TYPES,
			selected: new Set(["brainstorm/Note/v1"]),
			onToggle,
		});
		document.body.appendChild(el);
		const boxes = el.querySelectorAll<HTMLInputElement>(".db-source__check");
		expect(boxes[0]?.checked).toBe(false);
		expect(boxes[1]?.checked).toBe(true);
		boxes[0]?.click();
		expect(onToggle).toHaveBeenCalledWith("brainstorm/Task/v1", true);
	});

	test("filters rows by label and shows an empty note on no match", () => {
		const el = buildTypeChecklist({
			types: TYPES,
			selected: new Set(),
			onToggle: () => {},
			filter: "peo",
		});
		expect([...el.querySelectorAll(".db-source__name")].map((n) => n.textContent)).toEqual([
			"People",
		]);
		const none = buildTypeChecklist({
			types: TYPES,
			selected: new Set(),
			onToggle: () => {},
			filter: "zzz",
		});
		expect(none.querySelector(".db-source__empty")).not.toBeNull();
	});
});

describe("openSourcePicker", () => {
	const anchor = (): HTMLElement => {
		const a = document.createElement("button");
		document.body.appendChild(a);
		return a;
	};

	test("disables Create until a type is checked, then returns the selection", () => {
		const onConfirm = vi.fn();
		openSourcePicker({
			anchor: anchor(),
			availableTypes: TYPES,
			selectedTypes: [],
			title: "New list",
			confirmLabel: "Create list",
			onConfirm,
			onCancel: () => {},
		});
		const confirm = document.querySelector<HTMLButtonElement>("[data-bs-primary]");
		expect(confirm?.disabled).toBe(true);

		const firstBox = document.querySelector<HTMLInputElement>(".db-source__check");
		firstBox?.click();
		expect(confirm?.disabled).toBe(false);

		confirm?.click();
		expect(onConfirm).toHaveBeenCalledWith(["brainstorm/Task/v1"]);
	});

	test("Cancel fires onCancel and does not confirm", () => {
		const onConfirm = vi.fn();
		const onCancel = vi.fn();
		openSourcePicker({
			anchor: anchor(),
			availableTypes: TYPES,
			selectedTypes: ["brainstorm/Task/v1"],
			title: "New list",
			confirmLabel: "Create list",
			onConfirm,
			onCancel,
		});
		document.querySelector<HTMLButtonElement>(".bs-btn--ghost")?.click();
		expect(onCancel).toHaveBeenCalledOnce();
		expect(onConfirm).not.toHaveBeenCalled();
	});
});
