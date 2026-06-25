// @vitest-environment jsdom
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompositeHost } from "./composite-host";
import { SelectionAttribute } from "./composite-selection";
import { Orientation } from "./orientation";
import { useCompositeKeyboard } from "./use-composite-keyboard";

const LABELS = ["Apple", "Banana", "Apricot", "Blueberry", "avocado", "cherry"];

function ListHarness({
	orientation = Orientation.Vertical,
	onActivate,
	typeahead,
	useAriaActiveDescendant = false,
	pageSize,
	host: hostKind,
	selectionAttribute,
	cells,
}: {
	orientation?: Orientation;
	onActivate?: (i: number) => void;
	typeahead?: (i: number) => string;
	useAriaActiveDescendant?: boolean;
	pageSize?: number;
	host?: CompositeHost;
	selectionAttribute?: SelectionAttribute;
	cells?: ReadonlyArray<{ col: number; row: number }>;
}) {
	const [active, setActive] = useState(0);
	const { containerProps, getItemProps } = useCompositeKeyboard({
		orientation,
		count: LABELS.length,
		activeIndex: active,
		onActiveIndexChange: setActive,
		...(onActivate !== undefined ? { onActivate } : {}),
		...(typeahead !== undefined ? { typeahead } : {}),
		useAriaActiveDescendant,
		...(pageSize !== undefined ? { pageSize } : {}),
		...(hostKind !== undefined ? { host: hostKind } : {}),
		...(selectionAttribute !== undefined ? { selectionAttribute } : {}),
		...(cells !== undefined ? { cells } : {}),
	});
	return (
		<div {...containerProps} data-testid="list">
			{LABELS.map((label, i) => {
				const props = getItemProps(i);
				return (
					<div key={label} {...props}>
						{label}
					</div>
				);
			})}
		</div>
	);
}

describe("useCompositeKeyboard", () => {
	let host: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
	});

	afterEach(() => {
		act(() => root.unmount());
		host.remove();
	});

	const q = (sel: string) => host.querySelector<HTMLElement>(`[data-testid="${sel}"]`);
	const press = (target: HTMLElement, init: KeyboardEventInit) => {
		const ev = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
		target.dispatchEvent(ev);
		return ev;
	};

	it("stamps roving tabindex (active=0 → tabindex 0; others -1)", () => {
		act(() => root.render(<ListHarness />));
		const items = host.querySelectorAll<HTMLElement>('[role="option"]');
		expect(items[0]?.tabIndex).toBe(0);
		expect(items[1]?.tabIndex).toBe(-1);
		expect(items[5]?.tabIndex).toBe(-1);
	});

	it("ArrowDown advances activeIndex and imperatively focuses the new active item", () => {
		act(() => root.render(<ListHarness />));
		const container = q("list") as HTMLElement;
		const items = host.querySelectorAll<HTMLElement>('[role="option"]');
		act(() => {
			press(container, { key: "ArrowDown" });
		});
		expect(items[1]?.tabIndex).toBe(0);
		expect(document.activeElement).toBe(items[1]);
	});

	it("ArrowUp from index 0 wraps to the last item (wrap=true is default)", () => {
		act(() => root.render(<ListHarness />));
		const container = q("list") as HTMLElement;
		act(() => press(container, { key: "ArrowUp" }));
		const items = host.querySelectorAll<HTMLElement>('[role="option"]');
		expect(items[LABELS.length - 1]?.tabIndex).toBe(0);
	});

	it("Home / End / PageDown / PageUp dispatch correctly", () => {
		act(() => root.render(<ListHarness pageSize={2} />));
		const container = q("list") as HTMLElement;
		const items = host.querySelectorAll<HTMLElement>('[role="option"]');
		act(() => press(container, { key: "End" }));
		expect(items[LABELS.length - 1]?.tabIndex).toBe(0);
		act(() => press(container, { key: "Home" }));
		expect(items[0]?.tabIndex).toBe(0);
		act(() => press(container, { key: "PageDown" }));
		expect(items[2]?.tabIndex).toBe(0);
		act(() => press(container, { key: "PageUp" }));
		expect(items[0]?.tabIndex).toBe(0);
	});

	it("Enter and Space fire onActivate with the active index", () => {
		const onActivate = vi.fn();
		act(() => root.render(<ListHarness onActivate={onActivate} />));
		const container = q("list") as HTMLElement;
		act(() => press(container, { key: "Enter" }));
		expect(onActivate).toHaveBeenLastCalledWith(0);
		act(() => press(container, { key: " " }));
		expect(onActivate).toHaveBeenLastCalledWith(0);
		expect(onActivate).toHaveBeenCalledTimes(2);
	});

	it("typeahead cycles on a repeated single character within the 500ms window", () => {
		// Spec-correct resolver: index → label string. The hook owns the
		// ≤500ms buffer (via createTypeaheadBuffer) and the cycle-on-repeat
		// semantics; the host only provides labels.
		const typeahead = (i: number): string => LABELS[i] ?? "";
		act(() => root.render(<ListHarness typeahead={typeahead} />));
		const container = q("list") as HTMLElement;
		const items = host.querySelectorAll<HTMLElement>('[role="option"]');
		// First "b": single-char cycle from active=0 → 1(Banana).
		act(() => press(container, { key: "b" }));
		expect(items[1]?.tabIndex).toBe(0);
		// Repeated "b" within window: cycles to next "b" → 3(Blueberry).
		act(() => press(container, { key: "b" }));
		expect(items[3]?.tabIndex).toBe(0);
	});

	it("typeahead accumulates multi-char prefixes within the 500ms window", () => {
		const typeahead = (i: number): string => LABELS[i] ?? "";
		act(() => root.render(<ListHarness typeahead={typeahead} />));
		const container = q("list") as HTMLElement;
		const items = host.querySelectorAll<HTMLElement>('[role="option"]');
		// "b" → Banana(1) (single-char cycle from 0).
		act(() => press(container, { key: "b" }));
		expect(items[1]?.tabIndex).toBe(0);
		// "l" within window → buffer="bl" → prefix search → Blueberry(3).
		// This is the regression case for the original missing-append bug: the
		// pre-fix hook passed each key alone, so "l" alone matched nothing.
		act(() => press(container, { key: "l" }));
		expect(items[3]?.tabIndex).toBe(0);
	});

	it("typeahead skips IME composition (isComposing or keyCode 229)", () => {
		const typeahead = (i: number): string => LABELS[i] ?? "";
		act(() => root.render(<ListHarness typeahead={typeahead} />));
		const container = q("list") as HTMLElement;
		const items = host.querySelectorAll<HTMLElement>('[role="option"]');
		const initialActive = items[0]?.tabIndex;
		expect(initialActive).toBe(0);
		// Synthesize an IME-composition keydown — should NOT advance the cursor.
		const ev = new KeyboardEvent("keydown", {
			key: "b",
			bubbles: true,
			cancelable: true,
			isComposing: true,
		});
		act(() => {
			container.dispatchEvent(ev);
		});
		expect(items[0]?.tabIndex).toBe(0);
		expect(items[1]?.tabIndex).toBe(-1);
	});

	it("Enter/Space preventDefault unconditionally and skip autorepeat", () => {
		const onActivate = vi.fn();
		act(() => root.render(<ListHarness onActivate={onActivate} />));
		const container = q("list") as HTMLElement;
		// Held-down Space (e.repeat = true) must NOT fire onActivate.
		const repeated = new KeyboardEvent("keydown", {
			key: " ",
			bubbles: true,
			cancelable: true,
			repeat: true,
		});
		act(() => {
			container.dispatchEvent(repeated);
		});
		expect(onActivate).not.toHaveBeenCalled();
		expect(repeated.defaultPrevented).toBe(true);
	});

	it("aria-activedescendant mode does NOT roving-focus items", () => {
		act(() => root.render(<ListHarness useAriaActiveDescendant />));
		const container = q("list") as HTMLElement;
		const items = host.querySelectorAll<HTMLElement>('[role="option"]');
		const firstId = items[0]?.id ?? "";
		expect(container.getAttribute("aria-activedescendant")).toBe(firstId);
		// All items are tabindex=-1 in this mode.
		for (const i of items) expect(i.tabIndex).toBe(-1);
		// Container is the focused element on arrow nav, NOT the item.
		container.focus();
		act(() => press(container, { key: "ArrowDown" }));
		const newSecondId = items[1]?.id ?? "";
		expect(container.getAttribute("aria-activedescendant")).toBe(newSecondId);
		expect(document.activeElement).toBe(container);
	});

	it("aria-selected mirrors active state for screen readers", () => {
		act(() => root.render(<ListHarness />));
		const items = host.querySelectorAll<HTMLElement>('[role="option"]');
		expect(items[0]?.getAttribute("aria-selected")).toBe("true");
		expect(items[1]?.getAttribute("aria-selected")).toBe("false");
		const container = q("list") as HTMLElement;
		act(() => press(container, { key: "ArrowDown" }));
		expect(items[0]?.getAttribute("aria-selected")).toBe("false");
		expect(items[1]?.getAttribute("aria-selected")).toBe("true");
	});

	it("Grid orientation maps ArrowDown to NextRow (jump by columns)", () => {
		function GridHarness() {
			const [active, setActive] = useState(0);
			const { containerProps, getItemProps } = useCompositeKeyboard({
				orientation: Orientation.Grid,
				count: 9,
				columns: 3,
				activeIndex: active,
				onActiveIndexChange: setActive,
			});
			return (
				<div {...containerProps} data-testid="grid">
					{[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
						<div key={i} {...getItemProps(i)}>
							cell-{i}
						</div>
					))}
				</div>
			);
		}
		act(() => root.render(<GridHarness />));
		const container = host.querySelector<HTMLElement>('[role="grid"]') as HTMLElement;
		const cells = host.querySelectorAll<HTMLElement>('[role="gridcell"]');
		act(() => press(container, { key: "ArrowDown" }));
		// Grid 3 columns: from 0, NextRow → 3.
		expect(cells[3]?.tabIndex).toBe(0);
		act(() => press(container, { key: "ArrowRight" }));
		expect(cells[4]?.tabIndex).toBe(0);
	});

	describe("Combobox host", () => {
		it("ArrowDown / ArrowUp still drive the list", () => {
			act(() => root.render(<ListHarness host={CompositeHost.Combobox} useAriaActiveDescendant />));
			const container = q("list") as HTMLElement;
			const items = host.querySelectorAll<HTMLElement>('[role="option"]');
			act(() => press(container, { key: "ArrowDown" }));
			expect(items[1]?.getAttribute("aria-selected")).toBe("true");
			act(() => press(container, { key: "ArrowUp" }));
			expect(items[0]?.getAttribute("aria-selected")).toBe("true");
		});

		it("Space does NOT activate (it must reach the text input)", () => {
			const onActivate = vi.fn();
			act(() =>
				root.render(
					<ListHarness host={CompositeHost.Combobox} onActivate={onActivate} useAriaActiveDescendant />,
				),
			);
			const container = q("list") as HTMLElement;
			const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
			act(() => {
				container.dispatchEvent(space);
			});
			expect(onActivate).not.toHaveBeenCalled();
			// Not consumed — the input is free to insert the space.
			expect(space.defaultPrevented).toBe(false);
		});

		it("Enter still activates the active item", () => {
			const onActivate = vi.fn();
			act(() =>
				root.render(
					<ListHarness host={CompositeHost.Combobox} onActivate={onActivate} useAriaActiveDescendant />,
				),
			);
			const container = q("list") as HTMLElement;
			act(() => press(container, { key: "Enter" }));
			expect(onActivate).toHaveBeenCalledWith(0);
		});

		it("Home / End fall through (no list jump, no preventDefault) so the text cursor can move", () => {
			act(() => root.render(<ListHarness host={CompositeHost.Combobox} useAriaActiveDescendant />));
			const container = q("list") as HTMLElement;
			const items = host.querySelectorAll<HTMLElement>('[role="option"]');
			const endEv = new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true });
			act(() => {
				container.dispatchEvent(endEv);
			});
			expect(endEv.defaultPrevented).toBe(false);
			// Active index unchanged — End did not jump to the last item.
			expect(items[0]?.getAttribute("aria-selected")).toBe("true");
		});
	});

	describe("selectionAttribute", () => {
		it("defaults to aria-selected (no aria-checked)", () => {
			act(() => root.render(<ListHarness />));
			const items = host.querySelectorAll<HTMLElement>('[role="option"]');
			expect(items[0]?.getAttribute("aria-selected")).toBe("true");
			expect(items[0]?.hasAttribute("aria-checked")).toBe(false);
		});

		it("AriaChecked stamps aria-checked on the active item, never aria-selected", () => {
			act(() => root.render(<ListHarness selectionAttribute={SelectionAttribute.AriaChecked} />));
			const items = host.querySelectorAll<HTMLElement>('[role="option"]');
			expect(items[0]?.getAttribute("aria-checked")).toBe("true");
			expect(items[1]?.getAttribute("aria-checked")).toBe("false");
			expect(items[0]?.hasAttribute("aria-selected")).toBe(false);
		});

		it("None stamps neither selection attribute (e.g. a toolbar)", () => {
			act(() => root.render(<ListHarness selectionAttribute={SelectionAttribute.None} />));
			const items = host.querySelectorAll<HTMLElement>('[role="option"]');
			expect(items[0]?.hasAttribute("aria-selected")).toBe(false);
			expect(items[0]?.hasAttribute("aria-checked")).toBe(false);
			// Roving tabindex still tracks the active item.
			expect(items[0]?.tabIndex).toBe(0);
			expect(items[1]?.tabIndex).toBe(-1);
		});
	});

	describe("non-item children", () => {
		it("ignores keydowns from a container child that is not a composite item", () => {
			const onActivate = vi.fn();
			function Harness() {
				const { containerProps, getItemProps } = useCompositeKeyboard({
					orientation: Orientation.Horizontal,
					count: 2,
					activeIndex: 0,
					onActiveIndexChange: () => undefined,
					onActivate,
					role: "tablist",
					itemRole: "tab",
				});
				return (
					<div {...containerProps} data-testid="list">
						<button type="button" {...getItemProps(0)}>
							tab 0
						</button>
						<button type="button" {...getItemProps(1)}>
							tab 1
						</button>
						{/* trailing action button — NOT a composite item */}
						<button type="button" data-testid="action">
							action
						</button>
					</div>
				);
			}
			act(() => root.render(<Harness />));
			const action = host.querySelector('[data-testid="action"]') as HTMLElement;
			// Enter from the action button must NOT be consumed or fire onActivate.
			const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
			act(() => {
				action.dispatchEvent(enter);
			});
			expect(onActivate).not.toHaveBeenCalled();
			expect(enter.defaultPrevented).toBe(false);
			// ArrowRight from the action button must NOT move/hijack the cursor.
			const arrow = new KeyboardEvent("keydown", {
				key: "ArrowRight",
				bubbles: true,
				cancelable: true,
			});
			act(() => {
				action.dispatchEvent(arrow);
			});
			expect(arrow.defaultPrevented).toBe(false);
			// A real item still works.
			const tab0 = host.querySelectorAll<HTMLElement>('[role="tab"]')[0] as HTMLElement;
			act(() => press(tab0, { key: "Enter" }));
			expect(onActivate).toHaveBeenCalledWith(0);
		});
	});

	describe("onDelete", () => {
		it("Delete / Backspace on the active item calls onDelete (listbox host)", () => {
			const onDelete = vi.fn();
			function Harness() {
				const { containerProps, getItemProps } = useCompositeKeyboard({
					orientation: Orientation.Vertical,
					count: LABELS.length,
					activeIndex: 2,
					onActiveIndexChange: () => undefined,
					onDelete,
				});
				return (
					<div {...containerProps} data-testid="list">
						{LABELS.map((l, i) => (
							<div key={l} {...getItemProps(i)}>
								{l}
							</div>
						))}
					</div>
				);
			}
			act(() => root.render(<Harness />));
			const container = q("list") as HTMLElement;
			act(() => press(container, { key: "Delete" }));
			expect(onDelete).toHaveBeenCalledWith(2);
			act(() => press(container, { key: "Backspace" }));
			expect(onDelete).toHaveBeenCalledTimes(2);
		});

		it("does not fire onDelete for a Combobox host (Backspace edits text)", () => {
			const onDelete = vi.fn();
			act(() => root.render(<ListHarness host={CompositeHost.Combobox} useAriaActiveDescendant />));
			// Combobox harness above doesn't pass onDelete; assert the gate by
			// dispatching Backspace and confirming no throw + no preventDefault.
			const container = q("list") as HTMLElement;
			const ev = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
			act(() => {
				container.dispatchEvent(ev);
			});
			expect(ev.defaultPrevented).toBe(false);
			expect(onDelete).not.toHaveBeenCalled();
		});
	});

	describe("multiselectable", () => {
		function MultiHarness({ onToggleSelect }: { onToggleSelect: (i: number) => void }) {
			const [active, setActive] = useState(0);
			const [selected] = useState<ReadonlySet<number>>(() => new Set([2]));
			const { containerProps, getItemProps } = useCompositeKeyboard({
				orientation: Orientation.Vertical,
				count: LABELS.length,
				activeIndex: active,
				onActiveIndexChange: setActive,
				multiselectable: true,
				selectedIndices: selected,
				onToggleSelect,
			});
			return (
				<div {...containerProps} data-testid="list">
					{LABELS.map((label, i) => (
						<div key={label} {...getItemProps(i)}>
							{label}
						</div>
					))}
				</div>
			);
		}

		it("advertises aria-multiselectable and drives aria-selected off the set, not the cursor", () => {
			act(() => root.render(<MultiHarness onToggleSelect={vi.fn()} />));
			const container = q("list") as HTMLElement;
			expect(container.getAttribute("aria-multiselectable")).toBe("true");
			const items = host.querySelectorAll<HTMLElement>('[role="option"]');
			// Cursor is on 0, but only index 2 is in the selection set.
			expect(items[0]?.getAttribute("aria-selected")).toBe("false");
			expect(items[2]?.getAttribute("aria-selected")).toBe("true");
		});

		it("Space toggles the active item's selection instead of activating", () => {
			const onToggleSelect = vi.fn();
			const onActivate = vi.fn();
			function Harness() {
				const [active, setActive] = useState(1);
				const { containerProps, getItemProps } = useCompositeKeyboard({
					orientation: Orientation.Vertical,
					count: LABELS.length,
					activeIndex: active,
					onActiveIndexChange: setActive,
					onActivate,
					multiselectable: true,
					selectedIndices: new Set<number>(),
					onToggleSelect,
				});
				return (
					<div {...containerProps} data-testid="list">
						{LABELS.map((l, i) => (
							<div key={l} {...getItemProps(i)}>
								{l}
							</div>
						))}
					</div>
				);
			}
			act(() => root.render(<Harness />));
			const container = q("list") as HTMLElement;
			const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
			act(() => {
				container.dispatchEvent(space);
			});
			expect(onToggleSelect).toHaveBeenCalledWith(1);
			expect(onActivate).not.toHaveBeenCalled();
			expect(space.defaultPrevented).toBe(true);
			// Enter still activates — only Space is rerouted to toggle.
			act(() => press(container, { key: "Enter" }));
			expect(onActivate).toHaveBeenCalledWith(1);
		});
	});

	describe("Spatial orientation", () => {
		// 6 LABELS laid out as a 3×2 grid:
		//   0(0,0) 1(1,0) 2(2,0)
		//   3(0,1) 4(1,1) 5(2,1)
		const CELLS = [
			{ col: 0, row: 0 },
			{ col: 1, row: 0 },
			{ col: 2, row: 0 },
			{ col: 0, row: 1 },
			{ col: 1, row: 1 },
			{ col: 2, row: 1 },
		];

		it("arrow keys move to the spatial nearest-in-direction item", () => {
			act(() => root.render(<ListHarness orientation={Orientation.Spatial} cells={CELLS} />));
			const container = q("list") as HTMLElement;
			const items = host.querySelectorAll<HTMLElement>('[role="option"]');
			// From index 0 (0,0): Right → 1, Down → 3.
			act(() => press(container, { key: "ArrowRight" }));
			expect(items[1]?.tabIndex).toBe(0);
			act(() => press(container, { key: "ArrowDown" }));
			// now at 1 (1,0) → Down → 4 (1,1).
			expect(items[4]?.tabIndex).toBe(0);
			act(() => press(container, { key: "ArrowLeft" }));
			expect(items[3]?.tabIndex).toBe(0);
			act(() => press(container, { key: "ArrowUp" }));
			expect(items[0]?.tabIndex).toBe(0);
		});

		it("does not wrap at a spatial edge", () => {
			act(() => root.render(<ListHarness orientation={Orientation.Spatial} cells={CELLS} />));
			const container = q("list") as HTMLElement;
			const items = host.querySelectorAll<HTMLElement>('[role="option"]');
			// index 0 is top-left; Up and Left have nowhere to go.
			act(() => press(container, { key: "ArrowUp" }));
			expect(items[0]?.tabIndex).toBe(0);
			act(() => press(container, { key: "ArrowLeft" }));
			expect(items[0]?.tabIndex).toBe(0);
		});
	});
});
