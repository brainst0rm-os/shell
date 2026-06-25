import { describe, expect, it } from "vitest";
import {
	PeriodKind,
	buildPeriodicSeedState,
	constituentDayKeys,
	isoWeekKeyOf,
	monthKeyOf,
	periodKeyOf,
	periodRange,
	periodStableId,
} from "./periods";

type Node = { type: string; tag?: string; children?: Node[]; text?: string; entityId?: string };

describe("month keys", () => {
	it("zero-pads the month", () => {
		expect(monthKeyOf(new Date(2026, 0, 5))).toBe("2026-01");
		expect(monthKeyOf(new Date(2026, 11, 31))).toBe("2026-12");
	});
});

describe("isoWeekKeyOf", () => {
	it("computes the ISO week (week 1 holds the first Thursday)", () => {
		// 2026-01-01 is a Thursday → ISO week 1 of 2026.
		expect(isoWeekKeyOf(new Date(2026, 0, 1))).toBe("2026-W01");
		// 2026-05-14 (Thu) falls in ISO week 20.
		expect(isoWeekKeyOf(new Date(2026, 4, 14))).toBe("2026-W20");
	});

	it("attributes early-January days to the prior week-year when ISO says so", () => {
		// 2027-01-01 is a Friday → ISO week 53 of 2026.
		expect(isoWeekKeyOf(new Date(2027, 0, 1))).toBe("2026-W53");
	});
});

describe("periodKeyOf / periodStableId", () => {
	it("routes by kind and namespaces the id", () => {
		const d = new Date(2026, 4, 14);
		expect(periodKeyOf(PeriodKind.Month, d)).toBe("2026-05");
		expect(periodKeyOf(PeriodKind.Week, d)).toBe("2026-W20");
		expect(periodStableId(PeriodKind.Month, "2026-05")).toBe("journal-month-2026-05");
		expect(periodStableId(PeriodKind.Week, "2026-W20")).toBe("journal-week-2026-W20");
	});
});

describe("periodRange / constituentDayKeys", () => {
	it("a month spans the 1st to the last day", () => {
		const { start, end } = periodRange(PeriodKind.Month, new Date(2026, 1, 14)); // Feb 2026
		expect(start.getDate()).toBe(1);
		expect(end.getDate()).toBe(28); // 2026 is not a leap year
		expect(constituentDayKeys(PeriodKind.Month, new Date(2026, 1, 14))).toHaveLength(28);
	});

	it("a week spans Monday..Sunday (7 days, ISO)", () => {
		const days = constituentDayKeys(PeriodKind.Week, new Date(2026, 4, 14)); // Thu
		expect(days).toHaveLength(7);
		expect(days[0]).toBe("2026-05-11"); // Monday
		expect(days[6]).toBe("2026-05-17"); // Sunday
	});
});

describe("buildPeriodicSeedState", () => {
	function root(state: ReturnType<typeof buildPeriodicSeedState>): Node {
		return (state as unknown as { root: Node }).root;
	}

	it("emits a heading, a mention paragraph per day link, and a writing paragraph", () => {
		const state = buildPeriodicSeedState("Week of May 11 – 17, 2026", [
			{ entityId: "journal-2026-05-11", label: "Mon, May 11" },
			{ entityId: "journal-2026-05-14", label: "Thu, May 14" },
		]);
		const children = root(state).children ?? [];
		expect(children[0]?.type).toBe("heading");
		expect(children[0]?.children?.[0]?.text).toBe("Week of May 11 – 17, 2026");
		// two mention paragraphs + one empty writing paragraph
		expect(children.slice(1).map((c) => c.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
		const firstMention = children[1]?.children?.[0];
		expect(firstMention?.type).toBe("mention");
		expect(firstMention?.entityId).toBe("journal-2026-05-11");
	});

	it("with no day links is just a heading + a writing paragraph", () => {
		const children = root(buildPeriodicSeedState("May 2026", [])).children ?? [];
		expect(children.map((c) => c.type)).toEqual(["heading", "paragraph"]);
	});
});
