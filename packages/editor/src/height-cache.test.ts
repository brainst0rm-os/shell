// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	BlockKind,
	ESTIMATED_CODE_LINE_HEIGHT_PX,
	ESTIMATED_EMBED_PX,
	ESTIMATED_HEADING_H1_PX,
	ESTIMATED_HEADING_H2_PX,
	ESTIMATED_HEADING_H3_PX,
	ESTIMATED_LINE_HEIGHT_PX,
	ESTIMATED_PARAGRAPH_CHARS_PER_LINE,
	createHeightCache,
} from "./height-cache";

/** Captures the `ResizeObserver` instances the cache creates so tests can
 *  drive their callbacks synchronously without a real layout engine. */
type FakeObserverHandle = {
	callback: ResizeObserverCallback;
	observed: Element[];
	unobserved: Element[];
	disconnected: boolean;
};

let lastObserver: FakeObserverHandle | null = null;
const originalResizeObserver = (globalThis as { ResizeObserver?: typeof ResizeObserver })
	.ResizeObserver;

function installFakeResizeObserver(): void {
	class FakeResizeObserver {
		readonly callback: ResizeObserverCallback;
		readonly observed: Element[] = [];
		readonly unobserved: Element[] = [];
		disconnected = false;

		constructor(callback: ResizeObserverCallback) {
			this.callback = callback;
			lastObserver = {
				callback: this.callback,
				observed: this.observed,
				unobserved: this.unobserved,
				disconnected: false,
			};
		}
		observe(el: Element): void {
			this.observed.push(el);
		}
		unobserve(el: Element): void {
			this.unobserved.push(el);
			if (lastObserver) lastObserver.unobserved = this.unobserved;
		}
		disconnect(): void {
			this.disconnected = true;
			if (lastObserver) lastObserver.disconnected = true;
		}
	}
	(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
		FakeResizeObserver as unknown as typeof ResizeObserver;
}

function uninstallFakeResizeObserver(): void {
	if (originalResizeObserver) {
		(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
			originalResizeObserver;
	} else {
		// biome-ignore lint/performance/noDelete: test must remove the global (exactOptionalPropertyTypes rejects = undefined)
		delete (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
	}
	lastObserver = null;
}

function makeEntry(target: Element, blockSize: number): ResizeObserverEntry {
	return {
		target,
		borderBoxSize: [{ blockSize, inlineSize: 0 }],
		contentBoxSize: [{ blockSize, inlineSize: 0 }],
		contentRect: { height: blockSize, width: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 },
		devicePixelContentBoxSize: [{ blockSize, inlineSize: 0 }],
	} as unknown as ResizeObserverEntry;
}

describe("estimate constants", () => {
	it("are all positive numbers", () => {
		for (const v of [
			ESTIMATED_LINE_HEIGHT_PX,
			ESTIMATED_HEADING_H1_PX,
			ESTIMATED_HEADING_H2_PX,
			ESTIMATED_HEADING_H3_PX,
			ESTIMATED_CODE_LINE_HEIGHT_PX,
			ESTIMATED_EMBED_PX,
			ESTIMATED_PARAGRAPH_CHARS_PER_LINE,
		]) {
			expect(typeof v).toBe("number");
			expect(v).toBeGreaterThan(0);
		}
	});
});

describe("createHeightCache().estimate", () => {
	it("returns the H1 constant for HeadingH1", () => {
		expect(createHeightCache().estimate(BlockKind.HeadingH1)).toBe(ESTIMATED_HEADING_H1_PX);
	});

	it("returns the H2 constant for HeadingH2", () => {
		expect(createHeightCache().estimate(BlockKind.HeadingH2)).toBe(ESTIMATED_HEADING_H2_PX);
	});

	it("returns the H3 constant for HeadingH3", () => {
		expect(createHeightCache().estimate(BlockKind.HeadingH3)).toBe(ESTIMATED_HEADING_H3_PX);
	});

	it("Code: returns hint × line-height", () => {
		expect(createHeightCache().estimate(BlockKind.Code, 5)).toBe(5 * ESTIMATED_CODE_LINE_HEIGHT_PX);
	});

	it("Code: reserves at least one line when hint is 0", () => {
		expect(createHeightCache().estimate(BlockKind.Code, 0)).toBe(ESTIMATED_CODE_LINE_HEIGHT_PX);
	});

	it("Embed: uses positive hint verbatim", () => {
		expect(createHeightCache().estimate(BlockKind.Embed, 600)).toBe(600);
	});

	it("Embed: no hint → default constant", () => {
		expect(createHeightCache().estimate(BlockKind.Embed)).toBe(ESTIMATED_EMBED_PX);
	});

	it("Embed: zero hint → default constant (not a 0-px reservation)", () => {
		expect(createHeightCache().estimate(BlockKind.Embed, 0)).toBe(ESTIMATED_EMBED_PX);
	});

	it("Paragraph: empty (0 chars) reserves one line of body height", () => {
		expect(createHeightCache().estimate(BlockKind.Paragraph, 0)).toBe(ESTIMATED_LINE_HEIGHT_PX);
	});

	it("Paragraph: 2-line content (160 chars at 80 chars/line) reserves 2 line-heights", () => {
		const expected = 2 * ESTIMATED_LINE_HEIGHT_PX;
		expect(
			createHeightCache().estimate(BlockKind.Paragraph, ESTIMATED_PARAGRAPH_CHARS_PER_LINE * 2),
		).toBe(expected);
	});

	it("Paragraph: char hint exceeding 1 line ceil-rounds line count", () => {
		// 81 chars at 80 chars/line → ceil(81/80)=2 lines.
		expect(
			createHeightCache().estimate(BlockKind.Paragraph, ESTIMATED_PARAGRAPH_CHARS_PER_LINE + 1),
		).toBe(2 * ESTIMATED_LINE_HEIGHT_PX);
	});
});

describe("createHeightCache() with a fake ResizeObserver", () => {
	beforeEach(() => {
		installFakeResizeObserver();
	});
	afterEach(() => {
		uninstallFakeResizeObserver();
	});

	it("`get(id)` is undefined for an unknown id", () => {
		const cache = createHeightCache();
		expect(cache.get("never-observed")).toBeUndefined();
	});

	it("`observe(id, el)` registers the element with the shared observer and writes measurements into the cache", () => {
		const cache = createHeightCache();
		const el = document.createElement("div");
		cache.observe("b1", el);
		expect(lastObserver?.observed).toContain(el);
		expect(cache.get("b1")).toBeUndefined();

		// Drive a layout callback.
		lastObserver?.callback([makeEntry(el, 137)], lastObserver as unknown as ResizeObserver);
		expect(cache.get("b1")).toBe(137);
		expect(cache.size()).toBe(1);
	});

	it("the disposer returned by `observe(id, el)` unobserves the element", () => {
		const cache = createHeightCache();
		const el = document.createElement("div");
		const dispose = cache.observe("b1", el);
		dispose();
		expect(lastObserver?.unobserved).toContain(el);
	});

	it("re-binding the same id to a new element unobserves the old element", () => {
		const cache = createHeightCache();
		const el1 = document.createElement("div");
		const el2 = document.createElement("div");
		cache.observe("b1", el1);
		cache.observe("b1", el2);
		expect(lastObserver?.unobserved).toContain(el1);
		expect(lastObserver?.observed).toContain(el2);
	});

	it("`dispose()` disconnects the observer, clears measurements, and resets `size()` to 0", () => {
		const cache = createHeightCache();
		const el = document.createElement("div");
		cache.observe("b1", el);
		lastObserver?.callback([makeEntry(el, 42)], lastObserver as unknown as ResizeObserver);
		expect(cache.size()).toBe(1);

		cache.dispose();
		expect(lastObserver?.disconnected).toBe(true);
		expect(cache.size()).toBe(0);
		expect(cache.get("b1")).toBeUndefined();
	});

	it("zero-height resize entries are ignored (height stays at last positive measurement)", () => {
		const cache = createHeightCache();
		const el = document.createElement("div");
		cache.observe("b1", el);
		lastObserver?.callback([makeEntry(el, 100)], lastObserver as unknown as ResizeObserver);
		lastObserver?.callback([makeEntry(el, 0)], lastObserver as unknown as ResizeObserver);
		expect(cache.get("b1")).toBe(100);
	});

	it("an unknown target in a callback batch is silently skipped (no throw)", () => {
		const cache = createHeightCache();
		const stranger = document.createElement("section");
		expect(() =>
			lastObserver?.callback([makeEntry(stranger, 99)], lastObserver as unknown as ResizeObserver),
		).not.toThrow();
		expect(cache.size()).toBe(0);
	});
});

describe("createHeightCache() without ResizeObserver support", () => {
	beforeEach(() => {
		// biome-ignore lint/performance/noDelete: test must remove the global (exactOptionalPropertyTypes rejects = undefined)
		delete (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
	});
	afterEach(() => {
		if (originalResizeObserver) {
			(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
				originalResizeObserver;
		}
	});

	it("constructs without throwing and observe/dispose are no-ops", () => {
		const cache = createHeightCache();
		const el = { nodeType: 1 } as unknown as Element;
		const dispose = cache.observe("b1", el);
		expect(() => dispose()).not.toThrow();
		expect(() => cache.dispose()).not.toThrow();
		expect(cache.get("b1")).toBeUndefined();
		expect(cache.size()).toBe(0);
	});
});

// Ensure `vi` import isn't tree-shaken away.
void vi;
