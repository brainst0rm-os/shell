import { describe, expect, it } from "vitest";
import {
	DEFAULT_DATE_BUCKET_LABELS,
	DateBucketKind,
	dateBucket,
	groupByDateBucket,
} from "./date-buckets";

// A fixed "now" mid-afternoon so day-boundary math is unambiguous.
const NOW = new Date("2026-05-19T15:00:00").getTime();
const DAY = 86_400_000;
const at = (t: number) => dateBucket(t, { now: NOW, locale: "en-US" });

describe("dateBucket", () => {
	it("buckets the same calendar day as Today (incl. earlier today and clock-skew future)", () => {
		expect(at(NOW).kind).toBe(DateBucketKind.Today);
		expect(at(new Date("2026-05-19T00:30:00").getTime()).kind).toBe(DateBucketKind.Today);
		expect(at(NOW + 5 * 60_000).kind).toBe(DateBucketKind.Today); // future → clamped
		expect(at(NOW).label).toBe("Today");
	});

	it("buckets the previous calendar day as Yesterday", () => {
		expect(at(new Date("2026-05-18T23:59:00").getTime()).kind).toBe(DateBucketKind.Yesterday);
		expect(at(new Date("2026-05-18T00:00:00").getTime()).kind).toBe(DateBucketKind.Yesterday);
	});

	it("buckets 2–7 days back as Last7, 8–30 as Last30", () => {
		expect(at(NOW - 3 * DAY).kind).toBe(DateBucketKind.Last7);
		expect(at(NOW - 7 * DAY).kind).toBe(DateBucketKind.Last7);
		expect(at(NOW - 12 * DAY).kind).toBe(DateBucketKind.Last30);
		expect(at(NOW - 30 * DAY).kind).toBe(DateBucketKind.Last30);
	});

	it("buckets older items by calendar month with a locale-formatted label", () => {
		const b = at(new Date("2026-02-10T12:00:00").getTime());
		expect(b.kind).toBe(DateBucketKind.Month);
		expect(b.key).toBe("m-2026-1"); // Feb = month index 1
		expect(b.label).toBe("February 2026");
		const old = at(new Date("2024-12-01T12:00:00").getTime());
		expect(old.label).toBe("December 2024");
	});

	it("is deterministic and honours custom labels", () => {
		const a = dateBucket(NOW, { now: NOW, labels: { today: "Aujourd’hui" } });
		const b = dateBucket(NOW, { now: NOW, labels: { today: "Aujourd’hui" } });
		expect(a).toEqual(b);
		expect(a.label).toBe("Aujourd’hui");
		expect(DEFAULT_DATE_BUCKET_LABELS.today).toBe("Today");
	});
});

describe("groupByDateBucket", () => {
	it("preserves most-recent-first input order across and within groups", () => {
		const rows = [
			{ id: "a", ts: NOW }, // Today
			{ id: "b", ts: NOW - 60_000 }, // Today
			{ id: "c", ts: NOW - DAY }, // Yesterday
			{ id: "d", ts: NOW - 4 * DAY }, // Last7
			{ id: "e", ts: NOW - 50 * DAY }, // a month bucket
		];
		const groups = groupByDateBucket(rows, (r) => r.ts, { now: NOW, locale: "en-US" });
		expect(groups.map((g) => g.bucket.kind)).toEqual([
			DateBucketKind.Today,
			DateBucketKind.Yesterday,
			DateBucketKind.Last7,
			DateBucketKind.Month,
		]);
		expect(groups[0]?.items.map((r) => r.id)).toEqual(["a", "b"]);
		expect(groups[3]?.items.map((r) => r.id)).toEqual(["e"]);
	});

	it("returns an empty array for no items", () => {
		expect(groupByDateBucket([], (n: number) => n, { now: NOW })).toEqual([]);
	});
});
