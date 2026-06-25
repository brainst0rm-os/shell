import { RecurrenceKind, Weekday } from "@brainstorm/sdk-types";
import { describe, expect, it } from "vitest";
import {
	type ScheduledFire,
	computeNextFire,
	dueFires,
	earliestFireAt,
	rescheduleAfterFire,
} from "./trigger-schedule";

const T0 = Date.UTC(2026, 5, 6, 9, 0, 0); // 2026-06-06 09:00 UTC
const DAY = 86_400_000;

describe("computeNextFire", () => {
	it("returns a future one-shot, null once it is in the past", () => {
		expect(computeNextFire({ oneShotAt: T0 + DAY }, T0)).toBe(T0 + DAY);
		expect(computeNextFire({ oneShotAt: T0 - DAY }, T0)).toBeNull();
		expect(computeNextFire({ oneShotAt: T0 }, T0)).toBeNull(); // strictly after
	});

	it("expands a structured recurrence via the 9.15.5 engine", () => {
		const next = computeNextFire({ recurrence: { kind: RecurrenceKind.Daily, every: 1 } }, T0);
		expect(next).toBe(T0 + DAY);
	});

	it("returns null for a Custom RRULE (no in-tree expander yet)", () => {
		expect(
			computeNextFire({ recurrence: { kind: RecurrenceKind.Custom, rrule: "FREQ=HOURLY" } }, T0),
		).toBeNull();
	});

	it("takes the earlier of a one-shot and a recurrence", () => {
		const weekly = {
			recurrence: { kind: RecurrenceKind.Weekly, every: 1, days: [Weekday.Mon] } as const,
			oneShotAt: T0 + DAY,
		};
		// the one-shot tomorrow beats next Monday
		expect(computeNextFire(weekly, T0)).toBe(T0 + DAY);
	});

	it("empty config never fires", () => {
		expect(computeNextFire({}, T0)).toBeNull();
	});
});

function fire(
	id: string,
	nextFireAt: number | null,
	workflowIds: string[] = [`wf_${id}`],
): ScheduledFire {
	return { triggerId: id, workflowIds, config: {}, nextFireAt };
}

describe("dueFires", () => {
	it("selects only armed triggers at-or-before now, earliest first", () => {
		const fires = [fire("c", T0 + DAY), fire("a", T0 - 10), fire("b", T0 - 5), fire("d", null)];
		expect(dueFires(fires, T0).map((f) => f.triggerId)).toEqual(["a", "b"]);
	});

	it("breaks ties by triggerId for determinism", () => {
		const fires = [fire("z", T0), fire("a", T0)];
		expect(dueFires(fires, T0).map((f) => f.triggerId)).toEqual(["a", "z"]);
	});

	it("never returns a dormant (null) trigger", () => {
		expect(dueFires([fire("a", null)], T0)).toEqual([]);
	});
});

describe("rescheduleAfterFire", () => {
	it("re-arms a recurring trigger from the fire instant (no missed-slot replay)", () => {
		const f: ScheduledFire = {
			triggerId: "t",
			workflowIds: ["wf"],
			config: { recurrence: { kind: RecurrenceKind.Daily, every: 1 } },
			nextFireAt: T0,
		};
		// scheduler woke 3 days late — next fire jumps forward, not back
		const rearmed = rescheduleAfterFire(f, T0 + 3 * DAY);
		expect(rearmed.nextFireAt).toBe(T0 + 4 * DAY);
	});

	it("sends a spent one-shot dormant", () => {
		const f: ScheduledFire = {
			triggerId: "t",
			workflowIds: ["wf"],
			config: { oneShotAt: T0 },
			nextFireAt: T0,
		};
		expect(rescheduleAfterFire(f, T0).nextFireAt).toBeNull();
	});
});

describe("earliestFireAt", () => {
	it("finds the soonest armed fire, ignoring dormant ones", () => {
		expect(earliestFireAt([fire("a", T0 + DAY), fire("b", T0 + 5), fire("c", null)])).toBe(T0 + 5);
	});

	it("returns null when nothing is armed", () => {
		expect(earliestFireAt([fire("a", null)])).toBeNull();
		expect(earliestFireAt([])).toBeNull();
	});
});
