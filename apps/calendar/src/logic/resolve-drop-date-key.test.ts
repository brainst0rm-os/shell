import { describe, expect, it } from "vitest";
import { buildDateKeyInfo } from "./from-vault-entities";
import { DEFAULT_DROP_DATE_KEY, dropDateValue, resolveDropDateKey } from "./resolve-drop-date-key";

const DATE_KEYS = buildDateKeyInfo([]).keys;

const MAY_30 = Date.UTC(2026, 4, 30); // a plausible date value
const JUN_30_LOCAL = new Date(2026, 5, 30, 0, 0, 0, 0).getTime();

describe("resolveDropDateKey", () => {
	it("falls back to the default key when the entity carries no date", () => {
		expect(resolveDropDateKey({}, DATE_KEYS)).toBe(DEFAULT_DROP_DATE_KEY);
		expect(resolveDropDateKey({ title: "Hi" }, DATE_KEYS)).toBe(DEFAULT_DROP_DATE_KEY);
	});

	it("reuses an existing single date key", () => {
		expect(resolveDropDateKey({ dueAt: MAY_30 }, DATE_KEYS)).toBe("dueAt");
		expect(resolveDropDateKey({ date: MAY_30 }, DATE_KEYS)).toBe("date");
	});

	it("prefers scheduledAt (the default) when it is among several present keys", () => {
		const props = { scheduledAt: MAY_30, dueAt: MAY_30, date: MAY_30 };
		expect(resolveDropDateKey(props, DATE_KEYS)).toBe("scheduledAt");
	});

	it("picks the highest-priority well-known key on a tie without scheduledAt", () => {
		// dueAt precedes completedAt/date in WELL_KNOWN_DATE_KEYS order.
		const props = { date: MAY_30, dueAt: MAY_30, completedAt: MAY_30 };
		expect(resolveDropDateKey(props, DATE_KEYS)).toBe("dueAt");
	});

	it("ignores an implausible value under a date key (out of the epoch window)", () => {
		expect(resolveDropDateKey({ dueAt: 42 }, DATE_KEYS)).toBe(DEFAULT_DROP_DATE_KEY);
		expect(resolveDropDateKey({ dueAt: "2026-05-30" }, DATE_KEYS)).toBe(DEFAULT_DROP_DATE_KEY);
	});

	it("reuses a catalog-only Date key not in the well-known set", () => {
		const withCustom = buildDateKeyInfo([{ key: "reviewOn", name: "Review on" }]).keys;
		expect(resolveDropDateKey({ reviewOn: MAY_30 }, withCustom)).toBe("reviewOn");
	});

	it("does not reuse a key absent from the live date-key set", () => {
		const narrow = new Set(["scheduledAt"]);
		// `dueAt` is dated but not a recognised date key here → default.
		expect(resolveDropDateKey({ dueAt: MAY_30 }, narrow)).toBe(DEFAULT_DROP_DATE_KEY);
	});
});

describe("dropDateValue", () => {
	it("returns the bare day start when there is no existing value", () => {
		expect(dropDateValue(undefined, JUN_30_LOCAL)).toBe(JUN_30_LOCAL);
		expect(dropDateValue(null, JUN_30_LOCAL)).toBe(JUN_30_LOCAL);
	});

	it("preserves the wall-clock time of an existing value on the new day", () => {
		const existing = new Date(2026, 4, 5, 9, 30).getTime(); // May 5 09:30 local
		const moved = dropDateValue(existing, JUN_30_LOCAL);
		const d = new Date(moved);
		expect(d.getMonth()).toBe(5);
		expect(d.getDate()).toBe(30);
		expect(d.getHours()).toBe(9);
		expect(d.getMinutes()).toBe(30);
	});

	it("keeps an all-day (midnight) value at midnight on the new day", () => {
		const existing = new Date(2026, 4, 5, 0, 0).getTime();
		expect(dropDateValue(existing, JUN_30_LOCAL)).toBe(JUN_30_LOCAL);
	});

	it("ignores an implausible existing value and lands at day start", () => {
		expect(dropDateValue(42, JUN_30_LOCAL)).toBe(JUN_30_LOCAL);
	});
});
