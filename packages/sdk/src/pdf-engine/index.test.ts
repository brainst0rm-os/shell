// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
	PDF_MAX_ZOOM,
	PDF_MIN_ZOOM,
	type PdfEngineDocument,
	type PdfEnginePage,
	type PdfOutlineNode,
	type RawPdfAnnotation,
	clampZoom,
	fitScale,
	pdfLinksFromAnnotations,
	pdfPageLinks,
	renderPdfPage,
	resolvePdfOutline,
	terminatePdfWorker,
} from "./index";

describe("clampZoom", () => {
	it("clamps into [PDF_MIN_ZOOM, PDF_MAX_ZOOM]", () => {
		expect(clampZoom(0)).toBe(PDF_MIN_ZOOM);
		expect(clampZoom(100)).toBe(PDF_MAX_ZOOM);
		expect(clampZoom(1.5)).toBe(1.5);
	});

	it("falls back to 1 on NaN", () => {
		expect(clampZoom(Number.NaN)).toBe(1);
	});
});

describe("fitScale", () => {
	it("picks the limiting axis", () => {
		expect(fitScale(100, 200, 50, 200)).toBe(0.5);
		expect(fitScale(200, 100, 200, 50)).toBe(0.5);
	});

	it("never upscales past 1×", () => {
		expect(fitScale(10, 10, 1000, 1000)).toBe(1);
	});

	it("degenerate sizes fall back to 1", () => {
		expect(fitScale(0, 100, 100, 100)).toBe(1);
		expect(fitScale(100, 100, 0, 100)).toBe(1);
	});
});

function fakePage(
	width: number,
	height: number,
): {
	page: PdfEnginePage;
	render: ReturnType<typeof vi.fn>;
} {
	const render = vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() });
	const page: PdfEnginePage = {
		getViewport: ({ scale }) => ({ width: width * scale, height: height * scale }),
		render,
	};
	return { page, render };
}

describe("renderPdfPage", () => {
	it("returns null when the canvas has no 2d context (jsdom default)", () => {
		const { page } = fakePage(100, 100);
		const canvas = document.createElement("canvas");
		expect(renderPdfPage(page, canvas, 1, 1)).toBeNull();
	});

	it("sizes the backing store by dpr and the CSS box by scale", () => {
		const { page, render } = fakePage(100, 200);
		const canvas = document.createElement("canvas");
		const ctx = {} as CanvasRenderingContext2D;
		vi.spyOn(canvas, "getContext").mockReturnValue(ctx as never);
		const task = renderPdfPage(page, canvas, 0.5, 2);
		expect(task).not.toBeNull();
		expect(canvas.width).toBe(100);
		expect(canvas.height).toBe(200);
		expect(canvas.style.width).toBe("50px");
		expect(canvas.style.height).toBe("100px");
		expect(render).toHaveBeenCalledWith(
			expect.objectContaining({ canvasContext: ctx, viewport: { width: 100, height: 200 } }),
		);
	});

	it("treats a non-positive dpr as 1", () => {
		const { page } = fakePage(100, 100);
		const canvas = document.createElement("canvas");
		vi.spyOn(canvas, "getContext").mockReturnValue({} as never);
		renderPdfPage(page, canvas, 1, 0);
		expect(canvas.width).toBe(100);
		expect(canvas.style.width).toBe("100px");
	});
});

describe("terminatePdfWorker", () => {
	it("no-ops when the engine never loaded", () => {
		expect(() => terminatePdfWorker()).not.toThrow();
	});
});

describe("pdfLinksFromAnnotations", () => {
	// Identity mapper — the raw rect already reads as [left, top, right, bottom].
	const identityViewport = { convertToViewportRectangle: (r: readonly number[]) => [...r] };

	function link(url: unknown, rect: readonly number[] = [10, 20, 110, 70]): RawPdfAnnotation {
		return { subtype: "Link", url, rect };
	}

	it("maps a web link's rect to a normalized CSS box", () => {
		expect(pdfLinksFromAnnotations([link("https://example.com")], identityViewport)).toEqual([
			{ url: "https://example.com", rect: { left: 10, top: 20, width: 100, height: 50 } },
		]);
	});

	it("normalizes a flipped (bottom-left origin) rect", () => {
		// convertToViewportRectangle can return y2 < y1; we min/abs into a box.
		const flipped = { convertToViewportRectangle: () => [110, 70, 10, 20] };
		expect(pdfLinksFromAnnotations([link("https://e.com")], flipped)[0]?.rect).toEqual({
			left: 10,
			top: 20,
			width: 100,
			height: 50,
		});
	});

	it("accepts http/https/mailto/tel and drops javascript/file/data + empty", () => {
		const out = pdfLinksFromAnnotations(
			[
				link("https://ok.com"),
				link("http://ok.com"),
				link("mailto:a@b.com"),
				link("tel:+15551234"),
				link("javascript:alert(1)"),
				link("file:///etc/passwd"),
				link("data:text/html,<b>x"),
				link(""),
				link(undefined),
			],
			identityViewport,
		);
		expect(out.map((l) => l.url)).toEqual([
			"https://ok.com",
			"http://ok.com",
			"mailto:a@b.com",
			"tel:+15551234",
		]);
	});

	it("falls back to unsafeUrl when url is absent", () => {
		const annotation: RawPdfAnnotation = {
			subtype: "Link",
			rect: [0, 0, 10, 10],
			unsafeUrl: "https://fallback.com",
		};
		expect(pdfLinksFromAnnotations([annotation], identityViewport)[0]?.url).toBe(
			"https://fallback.com",
		);
	});

	it("ignores non-Link annotations and zero-area rects", () => {
		expect(
			pdfLinksFromAnnotations(
				[
					{ subtype: "Widget", url: "https://x.com", rect: [0, 0, 10, 10] },
					link("https://zero.com", [5, 5, 5, 5]),
				],
				identityViewport,
			),
		).toEqual([]);
	});

	it("returns [] when the viewport can't map rects", () => {
		expect(pdfLinksFromAnnotations([link("https://x.com")], {})).toEqual([]);
	});
});

describe("pdfPageLinks", () => {
	it("returns [] for a page without getAnnotations", async () => {
		const page: PdfEnginePage = {
			getViewport: ({ scale }) => ({ width: 100 * scale, height: 100 * scale }),
			render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
		};
		expect(await pdfPageLinks(page, 1)).toEqual([]);
	});

	it("fetches annotations and maps them through the scaled viewport", async () => {
		const page: PdfEnginePage = {
			getViewport: ({ scale }) => ({
				width: 100 * scale,
				height: 100 * scale,
				convertToViewportRectangle: (r) => r.map((n) => n * scale),
			}),
			getAnnotations: async () => [{ subtype: "Link", url: "https://x.com", rect: [10, 10, 30, 20] }],
			render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
		};
		expect(await pdfPageLinks(page, 2)).toEqual([
			{ url: "https://x.com", rect: { left: 20, top: 20, width: 40, height: 20 } },
		]);
	});

	it("degrades to [] when getAnnotations rejects", async () => {
		const page: PdfEnginePage = {
			getViewport: ({ scale }) => ({
				width: scale,
				height: scale,
				convertToViewportRectangle: (r) => [...r],
			}),
			getAnnotations: async () => {
				throw new Error("decode failed");
			},
			render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
		};
		expect(await pdfPageLinks(page, 1)).toEqual([]);
	});
});

describe("resolvePdfOutline", () => {
	function fakeDoc(opts: {
		outline: PdfOutlineNode[] | null;
		named?: Record<string, unknown[] | null>;
		pageIndexOf?: (ref: unknown) => number;
	}): PdfEngineDocument {
		return {
			numPages: 10,
			getPage: () => Promise.reject(new Error("unused")),
			getMetadata: () => Promise.resolve({}),
			getOutline: () => Promise.resolve(opts.outline),
			getDestination: (dest) => Promise.resolve(opts.named?.[dest] ?? null),
			getPageIndex: (ref) =>
				opts.pageIndexOf
					? Promise.resolve(opts.pageIndexOf(ref))
					: Promise.resolve(typeof ref === "number" ? ref : 0),
			destroy: () => Promise.resolve(),
		};
	}

	it("flattens explicit + named destinations into page-indexed entries with depth", async () => {
		const doc = fakeDoc({
			outline: [
				{ title: "Intro", dest: [0] },
				{
					title: "Part I",
					dest: "part-1",
					items: [{ title: "Chapter 1", dest: [4] }],
				},
			],
			named: { "part-1": [3] },
		});
		expect(await resolvePdfOutline(doc)).toEqual([
			{ title: "Intro", pageIndex: 0, depth: 0 },
			{ title: "Part I", pageIndex: 3, depth: 0 },
			{ title: "Chapter 1", pageIndex: 4, depth: 1 },
		]);
	});

	it("skips broken bookmarks but keeps their children", async () => {
		const doc = fakeDoc({
			outline: [
				{
					title: "Broken",
					dest: "missing",
					items: [{ title: "Survivor", dest: [2] }],
				},
			],
			named: {},
		});
		expect(await resolvePdfOutline(doc)).toEqual([{ title: "Survivor", pageIndex: 2, depth: 1 }]);
	});

	it("returns [] for a document without an outline", async () => {
		expect(await resolvePdfOutline(fakeDoc({ outline: null }))).toEqual([]);
	});

	it("skips nodes whose page-ref resolution throws", async () => {
		const doc = fakeDoc({
			outline: [
				{ title: "Bad ref", dest: [{ broken: true }] },
				{ title: "Good", dest: [1] },
			],
			pageIndexOf: (ref) => {
				if (typeof ref !== "number") throw new Error("bad ref");
				return ref;
			},
		});
		expect(await resolvePdfOutline(doc)).toEqual([{ title: "Good", pageIndex: 1, depth: 0 }]);
	});
});
