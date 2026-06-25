import { describe, expect, it } from "vitest";
import type { ReminderDef } from "./automations";
import { completeReminder, snoozeReminder } from "./reminder-transitions";

const T0 = Date.parse("2026-06-08T09:00:00.000Z");
const DAY = 86_400_000;

describe("snoozeReminder", () => {
	it("pushes the next fire to the snooze instant and re-opens a completed reminder", () => {
		const done: ReminderDef = {
			subject: "Pay invoice",
			dueAt: new Date(T0).toISOString(),
			completedAt: new Date(T0).toISOString(),
		};
		const snoozed = snoozeReminder(done, T0 + DAY);
		expect(snoozed.snoozedUntil).toBe(new Date(T0 + DAY).toISOString());
		expect(snoozed.completedAt).toBeUndefined();
		expect(snoozed.dueAt).toBe(done.dueAt);
	});

	it("preserves target and recurrence", () => {
		const r: ReminderDef = {
			subject: "Standup",
			dueAt: new Date(T0).toISOString(),
			target: "person-1",
			recurrence: "FREQ=DAILY",
		};
		const snoozed = snoozeReminder(r, T0 + DAY);
		expect(snoozed.target).toBe("person-1");
		expect(snoozed.recurrence).toBe("FREQ=DAILY");
	});
});

describe("completeReminder", () => {
	it("marks complete at the given instant and clears a pending snooze", () => {
		const snoozed: ReminderDef = {
			subject: "Pay invoice",
			dueAt: new Date(T0).toISOString(),
			snoozedUntil: new Date(T0 + DAY).toISOString(),
		};
		const done = completeReminder(snoozed, T0 + 2 * DAY);
		expect(done.completedAt).toBe(new Date(T0 + 2 * DAY).toISOString());
		expect(done.snoozedUntil).toBeUndefined();
	});
});
