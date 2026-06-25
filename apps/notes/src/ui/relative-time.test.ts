import { describe, expect, it } from "vitest";
import { relativeTime } from "./relative-time";

const NOW = new Date("2026-05-12T12:00:00Z").getTime();

describe("relativeTime", () => {
	it("collapses sub-minute deltas to 'just now'", () => {
		expect(relativeTime(NOW - 30_000, NOW)).toBe("just now");
		expect(relativeTime(NOW - 100, NOW)).toBe("just now");
	});

	it("rounds minutes down", () => {
		expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe("5m");
		expect(relativeTime(NOW - 59 * 60_000, NOW)).toBe("59m");
	});

	it("rounds hours down within a day", () => {
		expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3h");
		expect(relativeTime(NOW - 23 * 3_600_000, NOW)).toBe("23h");
	});

	it("rounds days down within a week", () => {
		expect(relativeTime(NOW - 2 * 86_400_000, NOW)).toBe("2d");
		expect(relativeTime(NOW - 6 * 86_400_000, NOW)).toBe("6d");
	});

	it("clamps future timestamps to 'just now'", () => {
		expect(relativeTime(NOW + 5_000_000, NOW)).toBe("just now");
	});

	it("falls through to a month-day for older same-year dates", () => {
		const formatted = relativeTime(new Date("2026-02-14T00:00:00Z").getTime(), NOW);
		expect(formatted).toMatch(/Feb/);
		expect(formatted).not.toMatch(/2026/);
	});

	it("includes the year when the date is in a different year", () => {
		const formatted = relativeTime(new Date("2024-11-30T00:00:00Z").getTime(), NOW);
		expect(formatted).toMatch(/2024/);
	});
});
