import { describe, expect, it } from "vitest";
import { bucketTimestamps, cutoffBucketIndex } from "./history-buckets";

describe("bucketTimestamps", () => {
	it("distributes evenly-spaced timestamps across buckets; max lands in the last", () => {
		// 0,25,50,75,100 over [0,100] into 4 buckets:
		// edges at 25/50/75 → [0,25)=1 ·[25,50)=1 ·[50,75)=1 ·[75,100]=2.
		expect(bucketTimestamps([0, 25, 50, 75, 100], 0, 100, 4)).toEqual([1, 1, 1, 2]);
	});

	it("clamps out-of-range timestamps into the end buckets", () => {
		expect(bucketTimestamps([-50, 0, 100, 250], 0, 100, 2)).toEqual([2, 2]);
	});

	it("empty input → all-zero buckets of the requested length", () => {
		expect(bucketTimestamps([], 0, 100, 3)).toEqual([0, 0, 0]);
	});

	it("ignores non-finite timestamps", () => {
		expect(bucketTimestamps([Number.NaN, 10, Number.POSITIVE_INFINITY], 0, 100, 2)).toEqual([1, 0]);
	});

	it("min >= max (single-instant / single-event graph) → all in the last bucket", () => {
		expect(bucketTimestamps([5, 5, 5], 5, 5, 4)).toEqual([0, 0, 0, 3]);
		expect(bucketTimestamps([1, 2, 3], 9, 2, 3)).toEqual([0, 0, 3]); // inverted range
	});

	it("bucketCount <= 0 / non-finite → [] (no throw)", () => {
		expect(bucketTimestamps([1, 2], 0, 10, 0)).toEqual([]);
		expect(bucketTimestamps([1, 2], 0, 10, -3)).toEqual([]);
		expect(bucketTimestamps([1, 2], 0, 10, Number.NaN)).toEqual([]);
	});
});

describe("cutoffBucketIndex", () => {
	it("maps a cutoff to its bucket, clamped to range", () => {
		expect(cutoffBucketIndex(0, 0, 100, 4)).toBe(0);
		expect(cutoffBucketIndex(50, 0, 100, 4)).toBe(2);
		expect(cutoffBucketIndex(100, 0, 100, 4)).toBe(3); // max → last
		expect(cutoffBucketIndex(-20, 0, 100, 4)).toBe(0);
		expect(cutoffBucketIndex(999, 0, 100, 4)).toBe(3);
	});

	it("null / non-finite cutoff (history off) → the last bucket (all revealed)", () => {
		expect(cutoffBucketIndex(null, 0, 100, 5)).toBe(4);
		expect(cutoffBucketIndex(Number.NaN, 0, 100, 5)).toBe(4);
	});

	it("degenerate range → last bucket; bucketCount<=0 → -1", () => {
		expect(cutoffBucketIndex(5, 7, 7, 3)).toBe(2);
		expect(cutoffBucketIndex(5, 0, 10, 0)).toBe(-1);
	});
});
