import { describe, expect, it } from "vitest";
import {
	formatReminderTime,
	minutesOfDay,
	parseReminderTime,
	shouldFireWriteReminder,
} from "./write-reminder";

describe("parseReminderTime / formatReminderTime", () => {
	it("round-trips a valid HH:MM", () => {
		expect(parseReminderTime("20:30")).toBe(20 * 60 + 30);
		expect(formatReminderTime(20 * 60 + 30)).toBe("20:30");
		expect(formatReminderTime(9 * 60 + 5)).toBe("09:05");
	});

	it("rejects malformed / out-of-range times", () => {
		expect(parseReminderTime("24:00")).toBeNull();
		expect(parseReminderTime("12:60")).toBeNull();
		expect(parseReminderTime("noon")).toBeNull();
		expect(parseReminderTime("")).toBeNull();
	});
});

describe("minutesOfDay", () => {
	it("computes minutes since local midnight", () => {
		expect(minutesOfDay(new Date(2026, 4, 14, 21, 15))).toBe(21 * 60 + 15);
	});
});

describe("shouldFireWriteReminder", () => {
	const base = {
		targetMinutes: 20 * 60,
		lastFiredDateKey: null,
		todayKey: "2026-05-14",
		hasTodayEntry: false,
	};

	it("fires once the target time has passed and today is unwritten", () => {
		expect(shouldFireWriteReminder({ ...base, now: new Date(2026, 4, 14, 20, 1) })).toBe(true);
	});

	it("does not fire before the target time", () => {
		expect(shouldFireWriteReminder({ ...base, now: new Date(2026, 4, 14, 19, 59) })).toBe(false);
	});

	it("does not fire when today's entry already exists", () => {
		expect(
			shouldFireWriteReminder({ ...base, hasTodayEntry: true, now: new Date(2026, 4, 14, 21, 0) }),
		).toBe(false);
	});

	it("does not fire twice in the same day", () => {
		expect(
			shouldFireWriteReminder({
				...base,
				lastFiredDateKey: "2026-05-14",
				now: new Date(2026, 4, 14, 21, 0),
			}),
		).toBe(false);
	});

	it("fires again on a new day even after firing yesterday", () => {
		expect(
			shouldFireWriteReminder({
				...base,
				lastFiredDateKey: "2026-05-13",
				now: new Date(2026, 4, 14, 21, 0),
			}),
		).toBe(true);
	});
});
