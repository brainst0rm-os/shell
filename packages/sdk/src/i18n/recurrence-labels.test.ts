import { describe, expect, it } from "vitest";
import { buildRecurrenceLabels } from "./recurrence-labels";

describe("buildRecurrenceLabels", () => {
	it("resolves phrases by suffix and interpolates params", () => {
		const seen: Array<[string, Record<string, string | number> | undefined]> = [];
		const labels = buildRecurrenceLabels((key, params) => {
			seen.push([key, params]);
			return params ? `${key}:${JSON.stringify(params)}` : key;
		});

		expect(labels.daily).toBe("daily");
		expect(labels.custom).toBe("custom");
		expect(labels.none).toBe("none");
		expect(labels.everyNDays(3)).toBe('everyNDays:{"n":3}');
		expect(labels.yearlyOn("May", 1)).toBe('yearlyOn:{"month":"May","day":1}');
		expect(labels.ordinal["-1"]).toBe("ordinal.last");
		expect(labels.ordinal["1"]).toBe("ordinal.first");
	});

	it("derives weekday + month names from the locale, not the translator", () => {
		const labels = buildRecurrenceLabels((key) => key);
		// 2024-01-01 is a Monday; en-US short weekday for Monday is "Mon".
		expect(labels.weekdayShort.mon).toBe("Mon");
		expect(labels.weekdayShort.sun).toBe("Sun");
		expect(labels.monthName(1)).toBe("January");
		expect(labels.monthName(12)).toBe("December");
	});
});
