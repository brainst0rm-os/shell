import { describe, expect, it } from "vitest";
import {
	SLOTS_PER_DAY,
	TIME_SLOT_MINUTES,
	isOnGrid,
	minutesToHhmm,
	nearestSlotMinutes,
} from "./date-time-field-logic";

describe("nearestSlotMinutes (F-229 finding #3 — late-evening clamp)", () => {
	const lastSlot = (SLOTS_PER_DAY - 1) * TIME_SLOT_MINUTES;

	it("clamps a 23:46–23:59 time to the last slot (23:45) instead of wrapping to midnight", () => {
		// 23:53 used to round to 1440 → '00:00'; must stay 23:45 (1425).
		expect(nearestSlotMinutes(23, 53)).toBe(lastSlot);
		expect(minutesToHhmm(nearestSlotMinutes(23, 53))).toBe("23:45");
		expect(nearestSlotMinutes(23, 59)).toBe(lastSlot);
		expect(minutesToHhmm(nearestSlotMinutes(23, 59))).toBe("23:45");
	});

	it("rounds 23:45 boundary exactly to itself", () => {
		expect(nearestSlotMinutes(23, 45)).toBe(lastSlot);
		expect(minutesToHhmm(nearestSlotMinutes(23, 45))).toBe("23:45");
	});

	it("rounds an early off-grid time to the nearer grid slot", () => {
		// 00:07 → 00:00 (rounds down), 12:00 stays put.
		expect(minutesToHhmm(nearestSlotMinutes(0, 7))).toBe("00:00");
		expect(minutesToHhmm(nearestSlotMinutes(12, 0))).toBe("12:00");
		expect(minutesToHhmm(nearestSlotMinutes(9, 7))).toBe("09:00");
		expect(minutesToHhmm(nearestSlotMinutes(9, 8))).toBe("09:15");
	});

	it("never returns a value past the last slot of the day", () => {
		for (let h = 0; h < 24; h += 1) {
			for (let m = 0; m < 60; m += 1) {
				const snapped = nearestSlotMinutes(h, m);
				expect(snapped).toBeGreaterThanOrEqual(0);
				expect(snapped).toBeLessThanOrEqual(lastSlot);
			}
		}
	});
});

describe("isOnGrid (off-grid transient-option detection — finding #4)", () => {
	it("treats quarter-hour minutes as on-grid", () => {
		expect(isOnGrid(9, 0)).toBe(true);
		expect(isOnGrid(9, 15)).toBe(true);
		expect(isOnGrid(23, 45)).toBe(true);
	});

	it("flags off-grid minutes (so the stored time round-trips, not silently snaps)", () => {
		expect(isOnGrid(9, 7)).toBe(false);
		expect(isOnGrid(23, 53)).toBe(false);
		expect(isOnGrid(0, 1)).toBe(false);
	});
});
