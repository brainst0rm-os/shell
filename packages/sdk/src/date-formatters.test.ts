import { describe, expect, it } from "vitest";
import {
	type FormatContext,
	formatDate,
	formatGroupDate,
	formatNumber,
	formatRelativeDate,
	formatTime,
} from "./date-formatters";

const LABELS = { today: "Today", tomorrow: "Tomorrow", yesterday: "Yesterday" };
// A fixed midday anchor so intra-day time never shifts the calendar-day delta.
const NOW = new Date(2026, 4, 15, 12, 0, 0).getTime();
const atNoon = (y: number, m: number, d: number) => new Date(y, m, d, 12, 0, 0).getTime();

describe("formatRelativeDate — fixed anchors", () => {
	it("renders Today / Tomorrow / Yesterday", () => {
		expect(formatRelativeDate(NOW, NOW, LABELS)).toBe("Today");
		expect(formatRelativeDate(atNoon(2026, 4, 16), NOW, LABELS)).toBe("Tomorrow");
		expect(formatRelativeDate(atNoon(2026, 4, 14), NOW, LABELS)).toBe("Yesterday");
	});
});

describe("formatRelativeDate — calendar parity (window ±6, long weekday)", () => {
	it("shows a long weekday within ±6 days (past and future)", () => {
		// 2026-05-18 is a Monday; 3 days ahead.
		expect(formatRelativeDate(atNoon(2026, 4, 18), NOW, LABELS)).toBe("Monday");
		// 2026-05-12 is a Tuesday; 3 days back.
		expect(formatRelativeDate(atNoon(2026, 4, 12), NOW, LABELS)).toBe("Tuesday");
	});

	it("shows a locale month-day outside the window, with year when it differs", () => {
		expect(formatRelativeDate(atNoon(2026, 5, 30), NOW, LABELS)).toBe("Jun 30");
		expect(formatRelativeDate(atNoon(2027, 4, 30), NOW, LABELS)).toBe("May 30, 2027");
	});
});

describe("formatRelativeDate — tasks parity (forward-only short weekday)", () => {
	const opts = { weekdayBackDays: 1, weekdayForwardDays: 6, weekdayStyle: "short" as const };

	it("shows a short weekday only 2–6 days ahead", () => {
		expect(formatRelativeDate(atNoon(2026, 4, 18), NOW, LABELS, opts)).toBe("Mon");
	});

	it("does not show a weekday for past dates beyond yesterday", () => {
		// 3 days back → month-day, not a weekday.
		expect(formatRelativeDate(atNoon(2026, 4, 12), NOW, LABELS, opts)).toBe("May 12");
	});
});

describe("formatGroupDate — one consistent group-header shape (F-041)", () => {
	it("keeps the universal Today / Tomorrow / Yesterday anchors", () => {
		expect(formatGroupDate(NOW, NOW, LABELS)).toBe("Today");
		expect(formatGroupDate(atNoon(2026, 4, 16), NOW, LABELS)).toBe("Tomorrow");
		expect(formatGroupDate(atNoon(2026, 4, 14), NOW, LABELS)).toBe("Yesterday");
	});

	it("uses weekday + day + month for every other day — near AND far read the same", () => {
		// Near (3 days ahead, inside the old relative window) — NOT a bare weekday.
		expect(formatGroupDate(atNoon(2026, 4, 18), NOW, LABELS)).toBe("Mon, May 18");
		// Far (outside the window) — the SAME shape, not a stripped "Jun 16".
		expect(formatGroupDate(atNoon(2026, 5, 16), NOW, LABELS)).toBe("Tue, Jun 16");
	});

	it("appends the year when it differs from now", () => {
		expect(formatGroupDate(atNoon(2027, 4, 30), NOW, LABELS)).toBe("Sun, May 30, 2027");
	});

	it("never returns a bare weekday name (the 'which Saturday?' ambiguity)", () => {
		const sat = formatGroupDate(atNoon(2026, 4, 23), NOW, LABELS); // a Saturday, +8 days
		expect(sat).not.toBe("Saturday");
		expect(sat).toMatch(/\d/); // always carries a day-of-month
	});
});

describe("FormatContext-aware formatters (Track B)", () => {
	// A fixed instant: 2026-01-02 09:05 UTC.
	const INSTANT = Date.UTC(2026, 0, 2, 9, 5, 0);

	it("formatTime honours an explicit 12h / 24h hour cycle", () => {
		const h12 = formatTime(INSTANT, { hour12: true, timeZone: "UTC" });
		const h23 = formatTime(INSTANT, { hour12: false, timeZone: "UTC" });
		expect(h12.toLowerCase()).toMatch(/am|pm/);
		expect(h23).toMatch(/^0?9:05$/);
		expect(h23.toLowerCase()).not.toMatch(/am|pm/);
	});

	it("formatTime respects the time zone", () => {
		// 09:05 UTC is 10:05 in Berlin (CET, +1 in January).
		const berlin = formatTime(INSTANT, { hour12: false, timeZone: "Europe/Berlin" });
		expect(berlin).toMatch(/^10:05$/);
	});

	it("formatDate honours locale + time zone", () => {
		// en-US is month-first; de-DE is day-first.
		const us = formatDate(INSTANT, { locale: "en-US", timeZone: "UTC" }, { dateStyle: "short" });
		const de = formatDate(INSTANT, { locale: "de-DE", timeZone: "UTC" }, { dateStyle: "short" });
		expect(us).toMatch(/^0?1\/0?2\/(20)?26$/); // 1/2/26
		expect(de).toMatch(/0?2\.0?1\.(20)?26/); // 2.1.26
	});

	it("formatNumber groups per locale", () => {
		expect(formatNumber(1234567.5, { locale: "en-US" })).toBe("1,234,567.5");
		expect(formatNumber(1234567.5, { locale: "de-DE" })).toBe("1.234.567,5");
	});

	it("a missing/empty context reproduces host-default behaviour", () => {
		const ctx: FormatContext | undefined = undefined;
		// No throw, returns a non-empty string; exact value is host-locale-dependent.
		expect(formatDate(INSTANT, ctx).length).toBeGreaterThan(0);
		expect(formatTime(INSTANT).length).toBeGreaterThan(0);
		expect(formatNumber(42).length).toBeGreaterThan(0);
	});

	it("formatRelativeDate threads the context locale for the far-date fallback", () => {
		// +40 days from NOW → absolute month-day, formatted in de-DE.
		const de = formatRelativeDate(atNoon(2026, 5, 24), NOW, LABELS, undefined, { locale: "de-DE" });
		// German short month for June is "Juni"/"Jun." — assert it's not the en "Jun" bare form.
		expect(de).toMatch(/\d/);
	});
});

describe("invalid context degrades to host default, never throws (security: synced bad tags)", () => {
	const INSTANT = Date.UTC(2026, 0, 2, 9, 5, 0);
	// `FormatContext` carries CRDT-synced Settings → Regional values, so a peer
	// (or a future free-text field) can supply a tag Intl rejects with RangeError.
	// Thrown in render that would white-screen the app — these must degrade.
	const BAD_ZONE: FormatContext = { locale: "en-US", timeZone: "Mars/Olympus" };
	const BAD_LOCALE: FormatContext = { locale: "!!not-a-locale!!" };

	it("formatDate survives an invalid time zone", () => {
		expect(() => formatDate(INSTANT, BAD_ZONE)).not.toThrow();
		expect(formatDate(INSTANT, BAD_ZONE).length).toBeGreaterThan(0);
	});

	it("formatTime survives an invalid time zone", () => {
		expect(() => formatTime(INSTANT, BAD_ZONE)).not.toThrow();
		expect(formatTime(INSTANT, BAD_ZONE).length).toBeGreaterThan(0);
	});

	it("formatDate survives an invalid locale", () => {
		expect(() => formatDate(INSTANT, BAD_LOCALE)).not.toThrow();
		expect(formatDate(INSTANT, BAD_LOCALE).length).toBeGreaterThan(0);
	});

	it("formatNumber survives an invalid locale", () => {
		expect(() => formatNumber(1234.5, BAD_LOCALE)).not.toThrow();
		expect(formatNumber(1234.5, BAD_LOCALE).length).toBeGreaterThan(0);
	});

	it("formatRelativeDate survives an invalid time zone (near + far branches)", () => {
		expect(() =>
			formatRelativeDate(atNoon(2026, 4, 16), NOW, LABELS, undefined, BAD_ZONE),
		).not.toThrow();
		expect(() =>
			formatRelativeDate(atNoon(2026, 5, 24), NOW, LABELS, undefined, BAD_ZONE),
		).not.toThrow();
	});

	it("formatGroupDate survives an invalid time zone", () => {
		expect(() => formatGroupDate(atNoon(2026, 5, 24), NOW, LABELS, BAD_ZONE)).not.toThrow();
		expect(formatGroupDate(atNoon(2026, 5, 24), NOW, LABELS, BAD_ZONE).length).toBeGreaterThan(0);
	});
});
