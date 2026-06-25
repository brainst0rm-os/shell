import {
	ENGINE_TRIGGER_KINDS,
	EntityEventVerb,
	RecurrenceKind,
	TriggerKind,
	type Weekday,
} from "@brainstorm/sdk-types";
import { describe, expect, it } from "vitest";
import {
	BUILDER_TRIGGER_KINDS,
	TimePreset,
	builderTriggerFromDef,
	builderTriggerToDef,
	emptyBuilderTrigger,
} from "./builder-trigger";

describe("builder trigger", () => {
	it("offers only the engine-wired trigger kinds", () => {
		expect(BUILDER_TRIGGER_KINDS).toBe(ENGINE_TRIGGER_KINDS);
	});

	it("defaults to a Manual trigger", () => {
		expect(emptyBuilderTrigger().kind).toBe(TriggerKind.Manual);
	});

	it("maps a Manual trigger to an empty-config def", () => {
		const def = builderTriggerToDef(emptyBuilderTrigger());
		expect(def.kind).toBe(TriggerKind.Manual);
		expect(def.config).toEqual({});
		expect(def.enabled).toBe(true);
	});

	it("maps a daily Time preset to a Daily recurrence", () => {
		const def = builderTriggerToDef({ ...emptyBuilderTrigger(), kind: TriggerKind.Time });
		expect(def.kind).toBe(TriggerKind.Time);
		expect((def.config.recurrence as { kind: RecurrenceKind }).kind).toBe(RecurrenceKind.Daily);
	});

	it("maps a weekdays preset to a multi-day Weekly recurrence", () => {
		const def = builderTriggerToDef({
			...emptyBuilderTrigger(),
			kind: TriggerKind.Time,
			timePreset: TimePreset.Weekdays,
		});
		const rec = def.config.recurrence as { kind: RecurrenceKind; days?: Weekday[] };
		expect(rec.kind).toBe(RecurrenceKind.Weekly);
		expect(rec.days).toHaveLength(5);
	});

	it("maps an EntityEvent trigger to its type + verb config", () => {
		const def = builderTriggerToDef({
			...emptyBuilderTrigger(),
			kind: TriggerKind.EntityEvent,
			entityType: "  brainstorm/Bookmark/v1  ",
			verb: EntityEventVerb.Create,
		});
		expect(def.kind).toBe(TriggerKind.EntityEvent);
		expect(def.config).toEqual({
			entityType: "brainstorm/Bookmark/v1",
			verb: EntityEventVerb.Create,
		});
	});

	it("round-trips an EntityEvent def back into editable fields", () => {
		const def = builderTriggerToDef({
			...emptyBuilderTrigger(),
			kind: TriggerKind.EntityEvent,
			entityType: "brainstorm/Task/v1",
			verb: EntityEventVerb.Update,
		});
		const back = builderTriggerFromDef(def);
		expect(back.kind).toBe(TriggerKind.EntityEvent);
		expect(back.entityType).toBe("brainstorm/Task/v1");
		expect(back.verb).toBe(EntityEventVerb.Update);
	});

	it("recovers a weekly preset from a single-day recurrence", () => {
		const def = builderTriggerToDef({
			...emptyBuilderTrigger(),
			kind: TriggerKind.Time,
			timePreset: TimePreset.Weekly,
		});
		expect(builderTriggerFromDef(def).timePreset).toBe(TimePreset.Weekly);
	});

	it("recovers a monthly preset", () => {
		const def = builderTriggerToDef({
			...emptyBuilderTrigger(),
			kind: TriggerKind.Time,
			timePreset: TimePreset.Monthly,
		});
		expect(builderTriggerFromDef(def).timePreset).toBe(TimePreset.Monthly);
	});

	it("defaults a missing Time recurrence to daily", () => {
		const back = builderTriggerFromDef({ kind: TriggerKind.Time, config: {}, enabled: true });
		expect(back.timePreset).toBe(TimePreset.Daily);
	});
});
