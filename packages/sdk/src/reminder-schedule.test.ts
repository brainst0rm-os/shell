import { describe, expect, it, vi } from "vitest";
import {
	REMINDER_PRESET_MINUTES,
	type ReminderSource,
	createReminderScheduler,
	dueRemindersInWindow,
	normalizeReminders,
	reminderDedupeKey,
	reminderInstant,
	toggleReminder,
} from "./reminder-schedule";

const MIN = 60_000;
const START = 1_700_000_000_000;

function ev(over: Partial<ReminderSource> = {}): ReminderSource {
	return { id: "e1", title: "Standup", start: START, reminders: [10], ...over };
}

describe("reminder offsets", () => {
	it("normalizes to finite non-negative integers, deduped + sorted", () => {
		expect(normalizeReminders([60, 5, 5, 10])).toEqual([5, 10, 60]);
		expect(normalizeReminders([-1, 2.7, Number.NaN, "x", 30])).toEqual([2, 30]);
		expect(normalizeReminders("nope")).toEqual([]);
		expect(normalizeReminders(undefined)).toEqual([]);
	});

	it("computes the fire instant relative to start", () => {
		expect(reminderInstant(START, 0)).toBe(START);
		expect(reminderInstant(START, 10)).toBe(START - 10 * MIN);
	});

	it("toggles an offset in and out, staying normalized", () => {
		expect(toggleReminder([5, 60], 10)).toEqual([5, 10, 60]);
		expect(toggleReminder([5, 10, 60], 10)).toEqual([5, 60]);
	});

	it("exposes a sorted preset list including at-start", () => {
		expect(REMINDER_PRESET_MINUTES[0]).toBe(0);
		expect([...REMINDER_PRESET_MINUTES]).toEqual([...REMINDER_PRESET_MINUTES].sort((a, b) => a - b));
	});
});

describe("dueRemindersInWindow", () => {
	it("returns reminders whose fire instant falls in (after, through]", () => {
		const items = [ev({ reminders: [10, 60] })];
		const fire10 = START - 10 * MIN;
		const due = dueRemindersInWindow(items, fire10 - 1, fire10);
		expect(due).toHaveLength(1);
		expect(due[0]?.minutes).toBe(10);
		expect(due[0]?.fireAt).toBe(fire10);
	});

	it("excludes reminders outside the window and sorts by fireAt", () => {
		const items = [ev({ reminders: [0, 10, 60] })];
		const due = dueRemindersInWindow(items, START - 70 * MIN, START);
		expect(due.map((d) => d.minutes)).toEqual([60, 10, 0]);
	});

	it("contributes nothing for an item with no reminders", () => {
		expect(dueRemindersInWindow([ev({ reminders: [] })], 0, START + 1)).toEqual([]);
	});

	it("stamps a stable cross-window dedupeKey of `${id}#${fireAt}`", () => {
		const items = [ev({ id: "task7", reminders: [10] })];
		const fire10 = START - 10 * MIN;
		const due = dueRemindersInWindow(items, fire10 - 1, fire10);
		expect(due[0]?.dedupeKey).toBe(`task7#${fire10}`);
		expect(due[0]?.dedupeKey).toBe(reminderDedupeKey("task7", fire10));
	});
});

describe("createReminderScheduler", () => {
	it("fires each reminder once across overlapping ticks", () => {
		const notify = vi.fn();
		const items = [ev({ reminders: [10] })];
		const fire = START - 10 * MIN;
		const scheduler = createReminderScheduler({
			startedAt: fire - 5 * MIN,
			getItems: () => items,
			notify,
		});
		scheduler.tick(fire);
		scheduler.tick(fire + MIN);
		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify.mock.calls[0]?.[0]?.minutes).toBe(10);
	});

	it("does not back-fire reminders already in the past at creation", () => {
		const notify = vi.fn();
		const fire = START - 10 * MIN;
		const scheduler = createReminderScheduler({
			startedAt: fire + MIN,
			getItems: () => [ev({ reminders: [10] })],
			notify,
		});
		scheduler.tick(START);
		expect(notify).not.toHaveBeenCalled();
	});
});
