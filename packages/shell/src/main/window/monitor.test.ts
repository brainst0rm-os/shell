import { describe, expect, it } from "vitest";
import {
	type MonitorInfo,
	clampToMonitor,
	findMonitor,
	monitorIdFor,
	pickPrimary,
	resolvePlacement,
} from "./monitor";

const m1: MonitorInfo = {
	id: 1,
	bounds: { x: 0, y: 0, width: 1440, height: 900 },
	workArea: { x: 0, y: 24, width: 1440, height: 876 },
	scaleFactor: 2,
	primary: true,
};
const m2: MonitorInfo = {
	id: 2,
	bounds: { x: 1440, y: 0, width: 1920, height: 1080 },
	workArea: { x: 1440, y: 24, width: 1920, height: 1056 },
	scaleFactor: 1,
};

describe("monitorIdFor", () => {
	it("is deterministic for the same monitor", () => {
		expect(monitorIdFor(m1)).toBe(monitorIdFor(m1));
	});

	it("differs across distinct monitors", () => {
		expect(monitorIdFor(m1)).not.toBe(monitorIdFor(m2));
	});

	it("uses the prefix protocol marker", () => {
		expect(monitorIdFor(m1)).toMatch(/^mon_v1:[0-9a-f]{8}$/);
	});

	it("changes when scaleFactor changes", () => {
		expect(monitorIdFor(m1)).not.toBe(monitorIdFor({ ...m1, scaleFactor: 1.5 }));
	});
});

describe("findMonitor", () => {
	it("returns the matching monitor by id", () => {
		expect(findMonitor([m1, m2], monitorIdFor(m2))).toBe(m2);
	});
	it("returns null when no monitor matches", () => {
		expect(findMonitor([m1, m2], "mon_v1:deadbeef")).toBeNull();
	});
});

describe("pickPrimary", () => {
	it("returns the explicit primary", () => {
		expect(pickPrimary([m1, m2])).toBe(m1);
	});
	it("falls back to the first when no monitor is flagged primary", () => {
		expect(pickPrimary([{ ...m1, primary: false }, m2])).toEqual({ ...m1, primary: false });
	});
	it("throws when no monitors are connected", () => {
		expect(() => pickPrimary([])).toThrow(/no monitors/);
	});
});

describe("clampToMonitor", () => {
	it("keeps a fully-inside placement unchanged", () => {
		const result = clampToMonitor({ x: 100, y: 100, width: 800, height: 600 }, m1);
		expect(result).toMatchObject({ x: 100, y: 100, width: 800, height: 600 });
	});

	it("shifts a placement that's hanging off the right edge", () => {
		const result = clampToMonitor({ x: 1300, y: 100, width: 800, height: 600 }, m1);
		expect(result.x + result.width).toBeLessThanOrEqual(m1.workArea.x + m1.workArea.width);
	});

	it("enforces a minimum width / height", () => {
		const result = clampToMonitor({ x: 0, y: 0, width: 10, height: 10 }, m1, {
			minWidth: 400,
			minHeight: 300,
		});
		expect(result.width).toBeGreaterThanOrEqual(400);
		expect(result.height).toBeGreaterThanOrEqual(300);
	});

	it("recentres a window whose previous position is fully offscreen", () => {
		const result = clampToMonitor({ x: -10000, y: -10000, width: 800, height: 600 }, m1);
		// Within the monitor's work area, roughly centred.
		expect(result.x).toBeGreaterThanOrEqual(m1.workArea.x);
		expect(result.x + result.width).toBeLessThanOrEqual(m1.workArea.x + m1.workArea.width);
	});

	it("preserves the maximized flag", () => {
		const result = clampToMonitor({ x: 100, y: 100, width: 800, height: 600, maximized: true }, m1);
		expect(result.maximized).toBe(true);
	});
});

describe("resolvePlacement", () => {
	it("uses the original monitor when it's still connected", () => {
		const id = monitorIdFor(m2);
		const result = resolvePlacement(
			{ placement: { x: 1500, y: 100, width: 800, height: 600 }, monitorId: id },
			[m1, m2],
		);
		expect(result.monitor).toBe(m2);
		expect(result.fellBackToPrimary).toBe(false);
	});

	it("falls back to the primary monitor when the remembered one is gone", () => {
		const ghostId = "mon_v1:00000000";
		const result = resolvePlacement(
			{ placement: { x: -5000, y: -5000, width: 800, height: 600 }, monitorId: ghostId },
			[m1, m2],
		);
		expect(result.monitor).toBe(m1);
		expect(result.fellBackToPrimary).toBe(true);
		expect(result.placement.x).toBeGreaterThanOrEqual(m1.workArea.x);
	});
});
