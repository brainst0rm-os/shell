import { describe, expect, it } from "vitest";
import { isBirthdaySoon, nextBirthday } from "./birthday";

// Anchor "today" at a fixed local noon so the day math is deterministic.
const NOW = new Date(2026, 5, 7, 12, 0, 0).getTime(); // 2026-06-07

describe("nextBirthday", () => {
	it("is null for a missing / non-finite anchor", () => {
		expect(nextBirthday(null, NOW)).toBeNull();
		expect(nextBirthday(Number.NaN, NOW)).toBeNull();
	});

	it("reports a birthday three days out", () => {
		const anchor = new Date(1990, 5, 10).getTime(); // June 10, 1990
		const next = nextBirthday(anchor, NOW);
		expect(next?.daysUntil).toBe(3);
		expect(next?.ageTurning).toBe(36); // 2026 − 1990
	});

	it("reports today's birthday as zero days", () => {
		const anchor = new Date(1990, 5, 7).getTime(); // June 7
		expect(nextBirthday(anchor, NOW)?.daysUntil).toBe(0);
	});

	it("rolls a past-this-year birthday to next year", () => {
		const anchor = new Date(1990, 5, 1).getTime(); // June 1 — already passed
		const next = nextBirthday(anchor, NOW);
		expect(next).not.toBeNull();
		expect(next?.daysUntil).toBeGreaterThan(300);
		expect(next?.ageTurning).toBe(37); // turns 37 on the 2027 occurrence
	});
});

describe("isBirthdaySoon", () => {
	it("is true within the window, false outside / for null", () => {
		expect(isBirthdaySoon({ atMs: 0, daysUntil: 5, ageTurning: null }, 30)).toBe(true);
		expect(isBirthdaySoon({ atMs: 0, daysUntil: 45, ageTurning: null }, 30)).toBe(false);
		expect(isBirthdaySoon(null, 30)).toBe(false);
	});
});
