// @vitest-environment jsdom
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGridCellKeyboard } from "./use-grid-cell-keyboard";

const COLUMNS = 7;
const COUNT = 42;

function GridHarness({ onOpenCell }: { onOpenCell?: (i: number) => void }) {
	const [active, setActive] = useState(0);
	const { containerProps, getCellProps } = useGridCellKeyboard({
		columns: COLUMNS,
		count: COUNT,
		activeIndex: active,
		onActiveIndexChange: setActive,
		onOpenCell: onOpenCell ?? (() => {}),
	});
	return (
		<div {...containerProps} data-testid="grid">
			{Array.from({ length: COUNT }, (_, i) => {
				const props = getCellProps(i);
				return (
					// biome-ignore lint/suspicious/noArrayIndexKey: fixed-length test grid
					<div key={i} {...props}>
						<button type="button" tabIndex={-1}>
							{i}
						</button>
					</div>
				);
			})}
		</div>
	);
}

describe("useGridCellKeyboard", () => {
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

	const grid = () => host.querySelector<HTMLElement>('[data-testid="grid"]');
	const press = (target: HTMLElement, init: KeyboardEventInit) => {
		act(() => {
			target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
		});
	};

	it("stamps role=grid on the container and aria-activedescendant on the active cell", () => {
		act(() => root.render(<GridHarness />));
		const g = grid();
		expect(g?.getAttribute("role")).toBe("grid");
		expect(g?.tabIndex).toBe(0);
		const cells = host.querySelectorAll<HTMLElement>('[role="gridcell"]');
		expect(cells).toHaveLength(COUNT);
		expect(g?.getAttribute("aria-activedescendant")).toBe(cells[0]?.id);
	});

	it("ArrowRight advances by one cell; ArrowDown advances by a row (columns)", () => {
		act(() => root.render(<GridHarness />));
		const g = grid();
		if (!g) throw new Error("no grid");
		const cells = host.querySelectorAll<HTMLElement>('[role="gridcell"]');
		press(g, { key: "ArrowRight" });
		expect(g.getAttribute("aria-activedescendant")).toBe(cells[1]?.id);
		press(g, { key: "ArrowDown" });
		expect(g.getAttribute("aria-activedescendant")).toBe(cells[1 + COLUMNS]?.id);
	});

	it("Enter / Space opens the active cell via onOpenCell", () => {
		const onOpenCell = vi.fn();
		act(() => root.render(<GridHarness onOpenCell={onOpenCell} />));
		const g = grid();
		if (!g) throw new Error("no grid");
		press(g, { key: "ArrowRight" });
		press(g, { key: "Enter" });
		expect(onOpenCell).toHaveBeenCalledWith(1);
		press(g, { key: " " });
		expect(onOpenCell).toHaveBeenCalledWith(1);
		expect(onOpenCell).toHaveBeenCalledTimes(2);
	});
});
