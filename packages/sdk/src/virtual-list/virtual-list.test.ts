/**
 * @vitest-environment jsdom
 *
 * `createVirtualList` is the DOM twin of the Notes sidebar's
 * `useVirtualizer`. jsdom has no layout engine, so the scroll viewport's
 * height is pinned via `offsetHeight` (what `@tanstack/virtual-core`'s
 * `getRect` reads) — that's enough to exercise the windowing contract:
 * a sized spacer + a bounded live row count + `refresh()` re-pull. Dynamic
 * measurement can't be exercised in jsdom (no layout), so the `measure: true`
 * case only asserts the wiring (`data-index` stamped, no throw).
 */
import { afterEach, describe, expect, it } from "vitest";
import { createVirtualList } from "./virtual-list";

const ROW = 32;

function makeViewport(viewportHeight: number): HTMLDivElement {
	const el = document.createElement("div");
	Object.defineProperty(el, "offsetHeight", { value: viewportHeight, configurable: true });
	document.body.appendChild(el);
	return el;
}

afterEach(() => {
	document.body.replaceChildren();
});

describe("createVirtualList", () => {
	it("sizes the spacer to count*rowHeight and only mounts a bounded window", () => {
		const el = makeViewport(200);
		const items = Array.from({ length: 200 }, (_, i) => `list-${i}`);
		const handle = createVirtualList<string>({
			scrollEl: el,
			rowHeight: ROW,
			getItems: () => items,
			renderRow: (item) => {
				const b = document.createElement("button");
				b.className = "row";
				b.textContent = item;
				return b;
			},
		});

		const spacer = el.querySelector(".bs-vlist__spacer") as HTMLElement;
		expect(spacer).not.toBeNull();
		expect(spacer.style.height).toBe(`${200 * ROW}px`);

		const rows = el.querySelectorAll(".row");
		// A 200px viewport over 32px rows windows to a single-digit slice
		// (+overscan), never the full 200 — that is the whole point.
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.length).toBeLessThan(200);
		const first = rows[0] as HTMLElement;
		expect(first.style.position).toBe("absolute");
		expect(first.style.height).toBe(`${ROW}px`);

		handle.destroy();
		expect(el.children.length).toBe(0);
	});

	it("refresh() re-pulls items and resizes the spacer", () => {
		const el = makeViewport(200);
		let items = Array.from({ length: 50 }, (_, i) => `a-${i}`);
		const handle = createVirtualList<string>({
			scrollEl: el,
			rowHeight: ROW,
			getItems: () => items,
			renderRow: (item) => {
				const b = document.createElement("button");
				b.className = "row";
				b.textContent = item;
				return b;
			},
		});
		const spacer = el.querySelector(".bs-vlist__spacer") as HTMLElement;
		expect(spacer.style.height).toBe(`${50 * ROW}px`);

		items = ["only-one"];
		handle.refresh();
		expect(spacer.style.height).toBe(`${1 * ROW}px`);
		expect(el.querySelectorAll(".row").length).toBe(1);

		handle.destroy();
	});

	it("reuses the same DOM node for an index that stays in the window across a scroll", () => {
		const el = makeViewport(200);
		const items = Array.from({ length: 200 }, (_, i) => `list-${i}`);
		let made = 0;
		createVirtualList<string>({
			scrollEl: el,
			rowHeight: ROW,
			getItems: () => items,
			renderRow: (item) => {
				made++;
				const b = document.createElement("button");
				b.className = "row";
				b.dataset.item = item;
				return b;
			},
		});

		const before = el.querySelector<HTMLElement>('.row[data-item="list-2"]');
		expect(before).not.toBeNull();
		const madeAtStart = made;

		// Scroll one row down — index 2 stays inside the window (overscan keeps a
		// few rows above the fold), so its node must be the SAME instance, not a
		// freshly rendered one (a new node re-loads its `<img>` → the blink).
		Object.defineProperty(el, "scrollTop", { value: ROW, configurable: true });
		el.dispatchEvent(new Event("scroll"));

		const after = el.querySelector<HTMLElement>('.row[data-item="list-2"]');
		expect(after).toBe(before);
		// The scroll reused the surviving rows; only the newly-entered bottom row
		// (if any) gets rendered — never the whole window again.
		expect(made - madeAtStart).toBeLessThan(madeAtStart);
	});

	it("never detaches a surviving row on scroll (preserves :hover — no blink)", () => {
		const el = makeViewport(200);
		const items = Array.from({ length: 200 }, (_, i) => `list-${i}`);
		createVirtualList<string>({
			scrollEl: el,
			rowHeight: ROW,
			getItems: () => items,
			renderRow: (item) => {
				const b = document.createElement("button");
				b.className = "row";
				b.dataset.item = item;
				return b;
			},
		});

		const spacer = el.querySelector(".bs-vlist__spacer") as HTMLElement;
		const survivor = spacer.querySelector<HTMLElement>('.row[data-item="list-2"]');
		expect(survivor).not.toBeNull();

		// A surviving row that the cursor is over must stay attached across the
		// scroll paint. Detaching + re-attaching it (what `replaceChildren` did)
		// drops `:hover` for a frame → the hover highlight blinks while scrolling.
		const observer = new MutationObserver(() => {});
		observer.observe(spacer, { childList: true });

		Object.defineProperty(el, "scrollTop", { value: ROW, configurable: true });
		el.dispatchEvent(new Event("scroll"));

		const removed = observer.takeRecords().flatMap((r) => Array.from(r.removedNodes));
		observer.disconnect();
		expect(removed).not.toContain(survivor);
		expect(survivor?.isConnected).toBe(true);
	});

	it("mounts into a separate host and offsets rows by the scroll margin (shared-scroll panel)", () => {
		// The shared viewport holds static content above the list; the list mounts
		// into an in-flow host below it, so the whole panel scrolls as one.
		const viewport = makeViewport(200);
		const staticHeader = document.createElement("div");
		staticHeader.className = "static-above";
		const host = document.createElement("div");
		// jsdom has no layout — pin the host's offset (= height of the static
		// content above) so `getScrollMargin` reports a non-zero margin.
		Object.defineProperty(host, "offsetTop", { value: 100, configurable: true });
		viewport.append(staticHeader, host);

		const items = Array.from({ length: 200 }, (_, i) => `list-${i}`);
		const handle = createVirtualList<string>({
			scrollEl: viewport,
			mountEl: host,
			getScrollMargin: () => host.offsetTop,
			rowHeight: ROW,
			getItems: () => items,
			renderRow: (item) => {
				const b = document.createElement("button");
				b.className = "row";
				b.dataset.item = item;
				return b;
			},
		});

		// The spacer lives in the host, NOT the scroll viewport, and the static
		// sibling above it is untouched (the list doesn't own the viewport).
		expect(host.querySelector(".bs-vlist__spacer")).not.toBeNull();
		expect(viewport.querySelector(".static-above")).not.toBeNull();

		// `v.start` includes the scroll margin; the host itself sits at that margin
		// in layout, so row 0 is placed at translateY(0) within the host.
		const first = host.querySelector<HTMLElement>('.row[data-item="list-0"]');
		expect(first).not.toBeNull();
		expect(first?.style.transform).toBe("translateY(0px)");

		// destroy clears the host but leaves the viewport's other content in place.
		handle.destroy();
		expect(host.children.length).toBe(0);
		expect(viewport.querySelector(".static-above")).not.toBeNull();
	});

	it("measure mode stamps data-index on rows and doesn't pin a fixed height", () => {
		const el = makeViewport(300);
		const items = Array.from({ length: 100 }, (_, i) => `card-${i}`);
		const handle = createVirtualList<string>({
			scrollEl: el,
			rowHeight: 96,
			measure: true,
			getItems: () => items,
			renderRow: (item) => {
				const div = document.createElement("div");
				div.className = "row";
				div.textContent = item;
				// jsdom has no layout, so pin a height for `measureElement` to read
				// (= the estimate, so windowing stays sane instead of collapsing to 0).
				Object.defineProperty(div, "offsetHeight", { value: 96, configurable: true });
				return div;
			},
		});

		const rows = el.querySelectorAll<HTMLElement>(".row");
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.length).toBeLessThan(100);
		const first = rows[0] as HTMLElement;
		// Measured rows carry the index attribute virtual-core reads, and do
		// NOT get a hard inline height (the measurement supplies it).
		expect(first.dataset.index).toBe("0");
		expect(first.style.height).toBe("");

		handle.destroy();
	});
});
