import { describe, expect, it } from "vitest";
import {
	commonTimeZones,
	groupedTimeZones,
	listTimeZones,
	localTimeZone,
	normalizeTimeZone,
	tzOffsetMs,
	tzShortName,
	utcToZonedParts,
	zonedTimeToUtc,
} from "./timezone";

const NY = "America/New_York";
const HOUR = 3_600_000;

// 2026-07-01T16:00:00Z — summer (EDT = UTC-4) → NY wall-clock 12:00.
const SUMMER_UTC = Date.UTC(2026, 6, 1, 16, 0, 0);
// 2026-01-01T17:00:00Z — winter (EST = UTC-5) → NY wall-clock 12:00.
const WINTER_UTC = Date.UTC(2026, 0, 1, 17, 0, 0);

describe("timezone", () => {
	it("converts a UTC instant to the zone's wall-clock", () => {
		expect(utcToZonedParts(SUMMER_UTC, NY)).toMatchObject({
			year: 2026,
			month: 7,
			day: 1,
			hour: 12,
			minute: 0,
		});
	});

	it("computes the zone offset, honouring DST", () => {
		expect(tzOffsetMs(SUMMER_UTC, NY)).toBe(-4 * HOUR);
		expect(tzOffsetMs(WINTER_UTC, NY)).toBe(-5 * HOUR);
	});

	it("round-trips wall-clock → UTC → wall-clock in both DST states", () => {
		const summer = zonedTimeToUtc({ year: 2026, month: 7, day: 1, hour: 12, minute: 0 }, NY);
		expect(summer).toBe(SUMMER_UTC);
		const winter = zonedTimeToUtc({ year: 2026, month: 1, day: 1, hour: 12, minute: 0 }, NY);
		expect(winter).toBe(WINTER_UTC);
	});

	it("UTC zone is a no-op offset", () => {
		expect(tzOffsetMs(SUMMER_UTC, "UTC")).toBe(0);
		expect(utcToZonedParts(SUMMER_UTC, "UTC").hour).toBe(16);
	});

	it("returns a non-empty short name and 'UTC' for UTC", () => {
		expect(tzShortName(SUMMER_UTC, "UTC")).toBe("UTC");
		expect(tzShortName(SUMMER_UTC, NY).length).toBeGreaterThan(0);
	});

	it("normalizes valid zones and rejects junk", () => {
		expect(normalizeTimeZone(NY)).toBe(NY);
		expect(normalizeTimeZone("Not/AZone")).toBeNull();
		expect(normalizeTimeZone("")).toBeNull();
		expect(normalizeTimeZone(42)).toBeNull();
	});

	it("lists zones with the local one first", () => {
		const zones = listTimeZones();
		expect(zones.length).toBeGreaterThan(0);
		expect(zones[0]).toBe(localTimeZone());
	});

	it("offers a short common shortlist, local first, including UTC, no dupes", () => {
		const common = commonTimeZones();
		expect(common[0]).toBe(localTimeZone());
		expect(common).toContain("UTC");
		// A shortcut, not the whole database.
		expect(common.length).toBeLessThan(15);
		expect(new Set(common).size).toBe(common.length);
		// Every entry is a valid IANA zone.
		for (const z of common) expect(normalizeTimeZone(z)).toBe(z);
	});

	it("groups the full zone list by region, sorted, with no region empty", () => {
		const groups = groupedTimeZones();
		expect(groups.length).toBeGreaterThan(1);
		// Region labels are sorted.
		const regions = groups.map((g) => g.region);
		expect([...regions].sort((a, b) => a.localeCompare(b))).toEqual(regions);
		for (const g of groups) {
			expect(g.zones.length).toBeGreaterThan(0);
			// Zones within a region are sorted.
			expect([...g.zones].sort((a, b) => a.localeCompare(b))).toEqual(g.zones);
			// Every zone carries its region prefix (or sits under "Other").
			for (const z of g.zones) {
				if (g.region !== "Other") expect(z.startsWith(`${g.region}/`)).toBe(true);
			}
		}
		// The grouped set covers the same zones the flat list reports.
		const flat = new Set(listTimeZones());
		const fromGroups = new Set(groups.flatMap((g) => g.zones));
		expect(fromGroups).toEqual(flat);
	});
});
