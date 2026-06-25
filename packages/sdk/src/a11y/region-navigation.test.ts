import { describe, expect, it } from "vitest";
import { RegionId } from "./region-id";
import {
	type RegionEntry,
	type RegionState,
	regionFocus,
	regionInit,
	regionNext,
	regionPrevious,
} from "./region-navigation";

function lcg(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 0x100000000;
	};
}

const appRegions: RegionEntry[] = [
	{ id: RegionId.AppHeader, label: "header" },
	{ id: RegionId.AppNavSidebar, label: "nav" },
	{ id: RegionId.AppMain, label: "main" },
	{ id: RegionId.AppInspector, label: "inspector" },
];

describe("regionInit", () => {
	it("defaults active to the first region when none specified", () => {
		expect(regionInit(appRegions).activeRegionId).toBe(RegionId.AppHeader);
	});

	it("honours an explicit active id when present", () => {
		expect(regionInit(appRegions, RegionId.AppMain).activeRegionId).toBe(RegionId.AppMain);
	});

	it("falls back to the first when the explicit id is not in the list", () => {
		expect(regionInit(appRegions, "ghost").activeRegionId).toBe(RegionId.AppHeader);
	});

	it("activeRegionId is null when regions list is empty", () => {
		expect(regionInit([]).activeRegionId).toBe(null);
	});
});

describe("region-navigation property: 4× next / 4× previous returns to origin", () => {
	it("from every starting region, N steps returns home in either direction", () => {
		const rand = lcg(0xbada55);
		for (let trial = 0; trial < 30; trial++) {
			const startIdx = Math.floor(rand() * appRegions.length);
			const start = (appRegions[startIdx] as RegionEntry).id;
			let s: RegionState = regionInit(appRegions, start);
			for (let i = 0; i < appRegions.length; i++) s = regionNext(s);
			expect(s.activeRegionId).toBe(start);
			for (let i = 0; i < appRegions.length; i++) s = regionPrevious(s);
			expect(s.activeRegionId).toBe(start);
		}
	});
});

describe("regionNext / regionPrevious wrap behaviour", () => {
	it("next from the last region wraps to the first", () => {
		const s = regionInit(appRegions, RegionId.AppInspector);
		expect(regionNext(s).activeRegionId).toBe(RegionId.AppHeader);
	});

	it("previous from the first region wraps to the last", () => {
		const s = regionInit(appRegions, RegionId.AppHeader);
		expect(regionPrevious(s).activeRegionId).toBe(RegionId.AppInspector);
	});

	it("next/previous on an empty regions list returns unchanged state", () => {
		const s = regionInit([], null);
		expect(regionNext(s)).toBe(s);
		expect(regionPrevious(s)).toBe(s);
	});
});

describe("regionFocus", () => {
	it("jumps directly to a known id", () => {
		const s = regionInit(appRegions);
		expect(regionFocus(s, RegionId.AppMain).activeRegionId).toBe(RegionId.AppMain);
	});

	it("is a no-op for an unknown id", () => {
		const s = regionInit(appRegions);
		expect(regionFocus(s, "ghost")).toBe(s);
	});

	it("accepts app-declared opaque string ids alongside the enum", () => {
		const mixed: RegionEntry[] = [
			{ id: RegionId.AppHeader, label: "header" },
			{ id: "app/custom-panel", label: "custom" },
		];
		const s = regionInit(mixed);
		expect(regionFocus(s, "app/custom-panel").activeRegionId).toBe("app/custom-panel");
	});
});
