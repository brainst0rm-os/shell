// @vitest-environment jsdom
/**
 * KBN-A-database (gallery view) — the card grid's composite-keyboard contract:
 * the virtual viewport is a single-tab-stop `grid` (`aria-activedescendant`),
 * ArrowRight/Left move the cursor within a row, ArrowDown/Up move between rows,
 * and Enter opens. Dispatched on the container; the reducer fires
 * `onSelect`/`onOpen` by absolute card index, so per-card virtual rendering
 * (perf-CI) isn't needed to verify the wiring. Mirrors the list-view test.
 *
 * The gallery measures its viewport (a `ResizeObserver` + `clientWidth`) to
 * derive the column count; jsdom has neither, so the harness stubs a wide
 * viewport that resolves to a 3-column grid (two full rows from six cards) —
 * enough to exercise both within-row (Left/Right) and between-row (Up/Down).
 */

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompiledView } from "../logic/compile-view";
import type { EntityRow } from "../logic/in-memory-entities";
import type { GalleryLayoutOptions } from "../types/list-view";
import { GalleryView, type GalleryViewProps } from "./gallery-view";

const LAYOUT: GalleryLayoutOptions = {
	thumbnailSize: "medium",
	cardAspectRatio: "square",
	showFilename: false,
};

// medium cards are 220px wide, GRID_GAP 16 → floor((720+16)/(220+16)) = 3 cols.
const VIEWPORT_WIDTH = 720;

function row(id: string): EntityRow {
	return {
		id,
		type: "brainstorm/Task/v1",
		properties: { title: id },
		createdAt: 0,
		updatedAt: 0,
		deletedAt: null,
	};
}

// Six cards so a 3-column grid has two full rows to walk.
const COMPILED: CompiledView = {
	rows: [row("a"), row("b"), row("c"), row("d"), row("e"), row("f")],
	groups: [],
};

type Harness = { grid: HTMLElement; cleanup: () => void };

function mountGallery(props: Partial<GalleryViewProps>): Harness {
	const container = document.createElement("div");
	const stage = document.createElement("div");
	stage.className = "db-stage__body";
	stage.style.height = "600px";
	stage.append(container);
	document.body.append(stage);
	const root: Root = createRoot(container);
	act(() =>
		root.render(
			<GalleryView
				compiled={COMPILED}
				columns={[]}
				layout={LAYOUT}
				coverProperty={null}
				subtitleProperty={null}
				selectedIds={new Set(["a"])}
				onSelect={vi.fn()}
				onOpen={vi.fn()}
				{...props}
			/>,
		),
	);
	const grid = container.querySelector<HTMLElement>('[role="grid"]');
	if (!grid) throw new Error("grid not rendered");
	return {
		grid,
		cleanup: () => {
			act(() => root.unmount());
			stage.remove();
		},
	};
}

function press(node: HTMLElement, key: string): void {
	act(() => {
		node.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
	});
}

describe("GalleryView keyboard (KBN-A-database)", () => {
	let h: Harness | null = null;
	let widthSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		// jsdom ships neither ResizeObserver nor a layout engine; stub both so
		// the gallery resolves to a multi-column grid.
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe(): void {}
				unobserve(): void {}
				disconnect(): void {}
			},
		);
		widthSpy = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(VIEWPORT_WIDTH);
	});

	afterEach(() => {
		h?.cleanup();
		h = null;
		widthSpy.mockRestore();
		vi.unstubAllGlobals();
		document.body.innerHTML = "";
	});

	it("renders the cards as a single-tab-stop grid", () => {
		h = mountGallery({});
		expect(h.grid.getAttribute("role")).toBe("grid");
		expect(h.grid.getAttribute("tabindex")).toBe("0");
	});

	it("ArrowRight moves the selection cursor to the next card in the row (single-select)", () => {
		const onSelect = vi.fn();
		h = mountGallery({ selectedIds: new Set(["a"]), onSelect });
		press(h.grid, "ArrowRight");
		expect(onSelect).toHaveBeenCalledWith(COMPILED.rows[1], { shiftKey: false, metaKey: false });
	});

	it("ArrowLeft moves the cursor to the previous card", () => {
		const onSelect = vi.fn();
		h = mountGallery({ selectedIds: new Set(["b"]), onSelect });
		press(h.grid, "ArrowLeft");
		expect(onSelect).toHaveBeenCalledWith(COMPILED.rows[0], { shiftKey: false, metaKey: false });
	});

	it("ArrowDown moves the cursor a full row down (3 columns → +3)", () => {
		const onSelect = vi.fn();
		h = mountGallery({ selectedIds: new Set(["a"]), onSelect });
		press(h.grid, "ArrowDown");
		expect(onSelect).toHaveBeenCalledWith(COMPILED.rows[3], { shiftKey: false, metaKey: false });
	});

	it("Enter opens the active card", () => {
		const onOpen = vi.fn();
		h = mountGallery({ selectedIds: new Set(["b"]), onOpen });
		press(h.grid, "Enter");
		expect(onOpen).toHaveBeenCalledWith(COMPILED.rows[1]);
	});
});
