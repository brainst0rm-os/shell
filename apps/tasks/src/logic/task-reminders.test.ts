import { describe, expect, it } from "vitest";
import { Priority, type Task } from "../types/task";
import {
	DEFAULT_ALERT_HOUR,
	TaskAlertKind,
	taskAlertInstant,
	taskAlertKind,
	taskReminderSources,
} from "./task-reminders";

function task(over: Partial<Task> = {}): Task {
	return {
		id: "t1",
		name: "Ship the report",
		completedAt: null,
		priority: Priority.None,
		scheduledAt: null,
		dueAt: null,
		projectId: null,
		assigneeId: null,
		parentId: null,
		recurrence: null,
		statusKey: null,
		createdAt: 1,
		updatedAt: 1,
		...over,
	};
}

/** Local midnight for a fixed day. */
const MIDNIGHT = new Date(2026, 5, 9, 0, 0, 0, 0).getTime();
const TIMED = new Date(2026, 5, 9, 14, 30, 0, 0).getTime();

describe("taskAlertInstant", () => {
	it("moves a local-midnight instant to the default morning hour", () => {
		const at = new Date(taskAlertInstant(MIDNIGHT));
		expect(at.getHours()).toBe(DEFAULT_ALERT_HOUR);
		expect(at.getMinutes()).toBe(0);
		expect(at.getDate()).toBe(9);
	});

	it("keeps an instant carrying a real time-of-day verbatim", () => {
		expect(taskAlertInstant(TIMED)).toBe(TIMED);
	});
});

describe("taskReminderSources", () => {
	it("emits a due source for an open task with a deadline", () => {
		const sources = taskReminderSources([task({ dueAt: TIMED })]);
		expect(sources).toHaveLength(1);
		expect(sources[0]).toMatchObject({
			id: "t1#due",
			title: "Ship the report",
			start: TIMED,
			reminders: [0],
		});
	});

	it("emits both due + scheduled sources when the instants differ", () => {
		const scheduled = new Date(2026, 5, 8, 0, 0, 0, 0).getTime();
		const sources = taskReminderSources([task({ dueAt: MIDNIGHT, scheduledAt: scheduled })]);
		expect(sources.map((s) => s.id)).toEqual(["t1#due", "t1#scheduled"]);
	});

	it("drops the scheduled alert when it resolves to the due instant", () => {
		const sources = taskReminderSources([task({ dueAt: MIDNIGHT, scheduledAt: MIDNIGHT })]);
		expect(sources.map((s) => s.id)).toEqual(["t1#due"]);
	});

	it("skips completed tasks and tasks with no dates", () => {
		expect(
			taskReminderSources([task({ dueAt: TIMED, completedAt: 123 }), task({ id: "t2" })]),
		).toEqual([]);
	});
});

describe("taskAlertKind", () => {
	it("reads the kind suffix off the source id", () => {
		expect(taskAlertKind("t1#due")).toBe(TaskAlertKind.Due);
		expect(taskAlertKind("t1#scheduled")).toBe(TaskAlertKind.Scheduled);
	});

	it("defaults an unrecognised suffix to Due", () => {
		expect(taskAlertKind("weird-id")).toBe(TaskAlertKind.Due);
	});
});
