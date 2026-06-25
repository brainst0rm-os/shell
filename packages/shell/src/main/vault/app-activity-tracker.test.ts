import { afterEach, describe, expect, it } from "vitest";
import {
	appActivityIdleSeconds,
	noteAppActivity,
	resetAppActivityForTest,
} from "./app-activity-tracker";

describe("app-activity-tracker", () => {
	afterEach(() => {
		resetAppActivityForTest();
	});

	it("reports Infinity idle before any activity (falls back to system idle)", () => {
		expect(appActivityIdleSeconds(1_000)).toBe(Number.POSITIVE_INFINITY);
	});

	it("reports seconds elapsed since the last noted activity", () => {
		noteAppActivity(10_000);
		expect(appActivityIdleSeconds(10_000)).toBe(0);
		expect(appActivityIdleSeconds(13_500)).toBe(3.5);
	});

	it("never goes negative if the clock moves backwards", () => {
		noteAppActivity(10_000);
		expect(appActivityIdleSeconds(9_000)).toBe(0);
	});

	it("resets back to the Infinity baseline", () => {
		noteAppActivity(10_000);
		resetAppActivityForTest();
		expect(appActivityIdleSeconds(99_999)).toBe(Number.POSITIVE_INFINITY);
	});
});
