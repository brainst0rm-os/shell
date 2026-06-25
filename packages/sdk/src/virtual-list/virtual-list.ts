/**
 * createVirtualList — the DOM-imperative twin of the React `useVirtualizer`
 * pattern used by the Notes sidebar (`apps/notes/src/ui/notes-list.tsx`).
 * Both ride `@tanstack/virtual-core`; only the host differs. Absolute-
 * positioned windowed rows over a sized spacer so a vault with hundreds of
 * rows keeps the live DOM at a handful of nodes.
 *
 * Rows are uniform height by default (`rowHeight`). Pass `measure: true` for
 * variable-height rows (e.g. cards with an optional description / tag chips):
 * `rowHeight` becomes the initial estimate and each painted row is measured —
 * virtual-core re-windows when an actual height differs, and its ResizeObserver
 * keeps following late reflows (an image finishing load, say). The fixed-height
 * path is unchanged when `measure` is absent.
 */
import {
	Virtualizer,
	elementScroll,
	observeElementOffset,
	observeElementRect,
} from "@tanstack/virtual-core";

export type VirtualListOptions<T> = {
	scrollEl: HTMLElement;
	/** Where the windowed rows mount. Defaults to `scrollEl` (the list owns its
	 *  own scroll viewport). Pass a separate in-flow host when the list shares a
	 *  scroll container with other content — the host sits below that content and
	 *  `scrollEl` is the shared viewport — so the whole panel scrolls as one with
	 *  no nested scrollbar. Pair with `getScrollMargin`. */
	mountEl?: HTMLElement;
	/** Distance (px) from the top of `scrollEl`'s scrollable content to the start
	 *  of the windowed region (i.e. the offset of `mountEl`). Re-read on every
	 *  paint so it tracks content above the list growing/shrinking. Defaults to 0
	 *  (the list starts at the top of its own viewport). */
	getScrollMargin?: () => number;
	/** Uniform row height, or — with `measure: true` — the initial estimate. */
	rowHeight: number;
	overscan?: number;
	/** Measure each row's real height (variable-height rows). Default false. */
	measure?: boolean;
	getItems: () => readonly T[];
	renderRow: (item: T, index: number) => HTMLElement;
};

export type VirtualListHandle = {
	/** Re-pull `getItems()` and repaint the window (call after data changes). */
	refresh: () => void;
	destroy: () => void;
};

export function createVirtualList<T>(opts: VirtualListOptions<T>): VirtualListHandle {
	const { scrollEl, rowHeight, getItems, renderRow } = opts;
	const overscan = opts.overscan ?? 6;
	const measure = opts.measure ?? false;
	const mountEl = opts.mountEl ?? scrollEl;
	const getScrollMargin = opts.getScrollMargin ?? (() => 0);

	const spacer = document.createElement("div");
	spacer.className = "bs-vlist__spacer";
	mountEl.replaceChildren(spacer);

	let items = getItems();

	const virtualizer = new Virtualizer<HTMLElement, HTMLElement>({
		count: items.length,
		getScrollElement: () => scrollEl,
		estimateSize: () => rowHeight,
		scrollToFn: elementScroll,
		observeElementRect,
		observeElementOffset,
		overscan,
		scrollMargin: getScrollMargin(),
		onChange: () => paint(),
	});

	// Live rows keyed by item index. A scroll only shifts WHICH indices are in
	// the window — the items at the indices that stay visible are unchanged, so
	// their DOM is reused verbatim (only the `translateY` moves). Rebuilding
	// every row each frame would re-create each card's `<img>`, forcing a
	// re-fetch/re-decode that flashes the cover blank mid-scroll. `refresh()`
	// (a data change) drops the cache so reused indices re-render with new data.
	let rowCache = new Map<number, HTMLElement>();

	// `measureElement` can re-enter `paint` synchronously (it calls `onChange`
	// when a measured height differs). Guard against re-entrancy and coalesce
	// the follow-up paint so heights converge in a bounded number of passes.
	let painting = false;
	let repaintQueued = false;

	function paint(): void {
		if (painting) {
			repaintQueued = true;
			return;
		}
		painting = true;
		// Re-read the offset of the windowed region within the shared scroll
		// viewport (the content above the list may have grown/shrunk). With the
		// default same-element host this is 0 and a no-op.
		const scrollMargin = getScrollMargin();
		if (scrollMargin !== virtualizer.options.scrollMargin) {
			virtualizer.setOptions({ ...virtualizer.options, scrollMargin });
		}
		spacer.style.height = `${virtualizer.getTotalSize()}px`;
		const nextCache = new Map<number, HTMLElement>();
		const measured: HTMLElement[] = [];
		for (const v of virtualizer.getVirtualItems()) {
			const item = items[v.index];
			if (item === undefined) continue;
			const reused = rowCache.get(v.index);
			const row = reused ?? renderRow(item, v.index);
			row.style.position = "absolute";
			row.style.insetInline = "0";
			row.style.top = "0";
			// `v.start` is measured from the top of the scroll content (it already
			// includes `scrollMargin`); the spacer is itself mounted at that margin,
			// so subtract it to place the row within the spacer.
			row.style.transform = `translateY(${v.start - scrollMargin}px)`;
			if (measure) {
				row.dataset.index = String(v.index);
				measured.push(row);
			} else {
				row.style.height = `${rowHeight}px`;
			}
			nextCache.set(v.index, row);
			// Rows are positioned by `translateY`, so DOM order is irrelevant — only
			// membership matters. Append newly-entered rows; leave reused rows
			// attached exactly where they are. Detaching the row under the cursor
			// (what `replaceChildren` did every frame) dropped its `:hover` for a
			// frame, blinking the hover highlight + hover-revealed actions on scroll.
			if (reused === undefined) spacer.appendChild(row);
		}
		// Release rows that scrolled out of the window.
		for (const [index, row] of rowCache) {
			if (!nextCache.has(index)) row.remove();
		}
		rowCache = nextCache;
		if (measure) {
			for (const row of measured) virtualizer.measureElement(row);
		}
		painting = false;
		if (repaintQueued) {
			repaintQueued = false;
			paint();
		}
	}

	const unmount = virtualizer._didMount();
	virtualizer._willUpdate();
	paint();

	return {
		refresh() {
			items = getItems();
			// Data changed — the item at a given index may now be different, so the
			// reuse-by-index cache is stale. Detach the live rows and drop the cache;
			// the repaint re-renders every windowed row against the fresh items.
			for (const row of rowCache.values()) row.remove();
			rowCache = new Map();
			virtualizer.setOptions({ ...virtualizer.options, count: items.length });
			virtualizer._willUpdate();
			paint();
		},
		destroy() {
			unmount();
			rowCache = new Map();
			mountEl.replaceChildren();
		},
	};
}
