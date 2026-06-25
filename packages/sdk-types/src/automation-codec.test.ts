import { describe, expect, it } from "vitest";
import {
	propertiesToReminder,
	propertiesToTrigger,
	propertiesToWorkflow,
	reminderToProperties,
	triggerToProperties,
	workflowToProperties,
} from "./automation-codec";
import {
	ConcurrencyPolicy,
	type ReminderDef,
	StepKind,
	type TriggerDef,
	TriggerKind,
	type WorkflowDef,
} from "./automations";

describe("automation-codec", () => {
	it("round-trips a full WorkflowDef", () => {
		const def: WorkflowDef = {
			name: "Daily digest",
			description: "Posts a digest",
			icon: "bell",
			enabled: true,
			triggerId: "trig_1",
			steps: [{ id: "t", kind: StepKind.Trigger }],
			capabilities: ["notifications.post"],
			concurrency: ConcurrencyPolicy.Queue,
			tags: ["tag_1"],
		};
		expect(propertiesToWorkflow(workflowToProperties(def))).toEqual(def);
	});

	it("round-trips a full TriggerDef and ReminderDef", () => {
		const trigger: TriggerDef = {
			kind: TriggerKind.Time,
			config: { oneShotAt: 123 },
			enabled: true,
			lastFiredAt: "2026-06-01T00:00:00.000Z",
			nextFireAt: "2026-06-02T00:00:00.000Z",
		};
		expect(propertiesToTrigger(triggerToProperties(trigger))).toEqual(trigger);

		const reminder: ReminderDef = {
			subject: "Water plants",
			target: "ent_9",
			dueAt: "2026-06-07T09:00:00.000Z",
			recurrence: "RRULE:FREQ=DAILY",
			snoozedUntil: "2026-06-07T10:00:00.000Z",
			completedAt: "2026-06-07T11:00:00.000Z",
		};
		expect(propertiesToReminder(reminderToProperties(reminder))).toEqual(reminder);
	});

	it("decodes malformed bags to safe defaults without throwing", () => {
		expect(propertiesToWorkflow(null)).toEqual({
			name: "",
			enabled: false,
			triggerId: "",
			steps: [],
			capabilities: [],
		});
		expect(propertiesToWorkflow({ capabilities: [1, "ok", null] }).capabilities).toEqual(["ok"]);
		expect(propertiesToTrigger({ kind: "nonsense", config: "nope" })).toEqual({
			kind: TriggerKind.Manual,
			config: {},
			enabled: false,
		});
		expect(propertiesToReminder(undefined)).toEqual({ subject: "", dueAt: "" });
	});
});
