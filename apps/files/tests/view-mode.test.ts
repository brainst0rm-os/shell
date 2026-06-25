import { describe, expect, it } from "vitest";
import {
	DEFAULT_VIEW_MODE,
	SUPPORTED_VIEW_MODES,
	ViewMode,
	isListMode,
	isSupportedViewMode,
} from "../src/view-mode";

describe("view-mode", () => {
	it("declares list/icon-list/grid/gallery/column with stable wire values", () => {
		expect(ViewMode.List).toBe("list");
		expect(ViewMode.IconList).toBe("icon-list");
		expect(ViewMode.Grid).toBe("grid");
		expect(ViewMode.Gallery).toBe("gallery");
		expect(ViewMode.Column).toBe("column");
	});

	it("defaults to list (the spec's recommendation for folders > 50 members)", () => {
		expect(DEFAULT_VIEW_MODE).toBe(ViewMode.List);
	});

	it("ships list + icon-list + grid + gallery in v1 — column is deferred per OQ-174", () => {
		expect(SUPPORTED_VIEW_MODES).toEqual([
			ViewMode.List,
			ViewMode.IconList,
			ViewMode.Grid,
			ViewMode.Gallery,
		]);
	});

	it("recognises supported values via the type guard", () => {
		expect(isSupportedViewMode("list")).toBe(true);
		expect(isSupportedViewMode("icon-list")).toBe(true);
		expect(isSupportedViewMode("grid")).toBe(true);
		expect(isSupportedViewMode("gallery")).toBe(true);
		expect(isSupportedViewMode("column")).toBe(false);
		expect(isSupportedViewMode("nope")).toBe(false);
		expect(isSupportedViewMode(undefined)).toBe(false);
	});

	it("treats list + icon-list as one-lane lists, tile + column modes as not", () => {
		expect(isListMode(ViewMode.List)).toBe(true);
		expect(isListMode(ViewMode.IconList)).toBe(true);
		expect(isListMode(ViewMode.Grid)).toBe(false);
		expect(isListMode(ViewMode.Gallery)).toBe(false);
		expect(isListMode(ViewMode.Column)).toBe(false);
	});
});
