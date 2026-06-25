import { describe, expect, it } from "vitest";
import type { MonitorInfo } from "./monitor";
import { TilePreset, projectOntoMonitor, tileBounds } from "./tile";

const monitor: MonitorInfo = {
	id: 1,
	bounds: { x: 0, y: 0, width: 2000, height: 1200 },
	workArea: { x: 0, y: 40, width: 2000, height: 1160 },
	scaleFactor: 1,
	primary: true,
};

const second: MonitorInfo = {
	id: 2,
	bounds: { x: 2000, y: 0, width: 1280, height: 800 },
	workArea: { x: 2000, y: 0, width: 1280, height: 760 },
	scaleFactor: 1,
};

describe("tileBounds", () => {
	it("fills the work area", () => {
		const b = tileBounds(TilePreset.Fill, monitor);
		expect(b).toEqual({ x: 0, y: 40, width: 2000, height: 1160 });
	});

	it("left-half occupies the left side of the work area", () => {
		const b = tileBounds(TilePreset.LeftHalf, monitor);
		expect(b).toEqual({ x: 0, y: 40, width: 1000, height: 1160 });
	});

	it("right-half is the complement of left-half (no pixel gap)", () => {
		const left = tileBounds(TilePreset.LeftHalf, monitor);
		const right = tileBounds(TilePreset.RightHalf, monitor);
		expect(left.x + left.width).toBe(right.x);
		expect(left.width + right.width).toBe(monitor.workArea.width);
	});

	it("top/bottom halves cover the full work-area height with no gap", () => {
		const top = tileBounds(TilePreset.TopHalf, monitor);
		const bottom = tileBounds(TilePreset.BottomHalf, monitor);
		expect(top.y + top.height).toBe(bottom.y);
		expect(top.height + bottom.height).toBe(monitor.workArea.height);
	});

	it("quarters fit together without gap or overlap", () => {
		const tl = tileBounds(TilePreset.TopLeft, monitor);
		const tr = tileBounds(TilePreset.TopRight, monitor);
		const bl = tileBounds(TilePreset.BottomLeft, monitor);
		const br = tileBounds(TilePreset.BottomRight, monitor);
		expect(tl.width + tr.width).toBe(monitor.workArea.width);
		expect(bl.width + br.width).toBe(monitor.workArea.width);
		expect(tl.height + bl.height).toBe(monitor.workArea.height);
		expect(tl.x + tl.width).toBe(tr.x);
		expect(tl.y + tl.height).toBe(bl.y);
	});

	it("center sits inside the work area", () => {
		const c = tileBounds(TilePreset.Center, monitor);
		expect(c.x).toBeGreaterThanOrEqual(monitor.workArea.x);
		expect(c.y).toBeGreaterThanOrEqual(monitor.workArea.y);
		expect(c.x + c.width).toBeLessThanOrEqual(monitor.workArea.x + monitor.workArea.width);
		expect(c.y + c.height).toBeLessThanOrEqual(monitor.workArea.y + monitor.workArea.height);
	});

	it("respects work-area offset (menu bar) on second monitor", () => {
		const b = tileBounds(TilePreset.Fill, second);
		expect(b).toEqual({ x: 2000, y: 0, width: 1280, height: 760 });
	});
});

describe("projectOntoMonitor", () => {
	it("preserves the relative top-left within the target work area", () => {
		const source = { x: 500, y: 240, width: 800, height: 600 };
		const projected = projectOntoMonitor(source, monitor, second);
		// Relative x ≈ 0.25 of work-area width
		expect(projected.x).toBeGreaterThanOrEqual(second.workArea.x);
		expect(projected.x + projected.width).toBeLessThanOrEqual(
			second.workArea.x + second.workArea.width,
		);
		expect(projected.y).toBeGreaterThanOrEqual(second.workArea.y);
	});

	it("scales the window down if it doesn't fit on the smaller monitor", () => {
		const source = { x: 0, y: 40, width: 2000, height: 1160 };
		const projected = projectOntoMonitor(source, monitor, second);
		expect(projected.width).toBeLessThanOrEqual(second.workArea.width);
		expect(projected.height).toBeLessThanOrEqual(second.workArea.height);
	});

	it("enforces minimum width/height", () => {
		const source = { x: 100, y: 100, width: 200, height: 100 };
		const tiny: MonitorInfo = {
			id: 3,
			bounds: { x: 0, y: 0, width: 100, height: 100 },
			workArea: { x: 0, y: 0, width: 100, height: 100 },
			scaleFactor: 1,
		};
		const projected = projectOntoMonitor(source, monitor, tiny);
		expect(projected.width).toBeGreaterThanOrEqual(320 - 1); // min clamps even when monitor is smaller
		expect(projected.height).toBeGreaterThanOrEqual(240 - 1);
	});
});
