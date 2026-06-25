/**
 * Property-bag codec for the four automation entity types (11b.6 deploy).
 * Extracted from the automations app's `automation-repository.ts` so the
 * shell's session-open registration (which must decode the same persisted
 * `Workflow`/`Trigger`/`Reminder` rows to hydrate the scheduler) and the
 * app share ONE decode — the reuse the original module anticipated.
 *
 * Decode is defensive: a malformed bag degrades per-field to a safe
 * default and never throws — one bad row must not crash a list or
 * silence the scheduler.
 */

import {
	type ConcurrencyPolicy,
	type ReminderDef,
	type TriggerDef,
	TriggerKind,
	type WorkflowDef,
	type WorkflowStep,
	isConcurrencyPolicy,
	isTriggerKind,
} from "./automations";

export function workflowToProperties(def: WorkflowDef): Record<string, unknown> {
	const props: Record<string, unknown> = {
		name: def.name,
		enabled: def.enabled,
		triggerId: def.triggerId,
		steps: def.steps,
		capabilities: [...def.capabilities],
	};
	if (def.description !== undefined) props.description = def.description;
	if (def.icon !== undefined) props.icon = def.icon;
	if (def.concurrency !== undefined) props.concurrency = def.concurrency;
	if (def.tags !== undefined) props.tags = [...def.tags];
	return props;
}

export function propertiesToWorkflow(
	props: Record<string, unknown> | null | undefined,
): WorkflowDef {
	const p = props ?? {};
	const def: WorkflowDef = {
		name: typeof p.name === "string" ? p.name : "",
		enabled: p.enabled === true,
		triggerId: typeof p.triggerId === "string" ? p.triggerId : "",
		steps: Array.isArray(p.steps) ? (p.steps as WorkflowStep[]) : [],
		capabilities: Array.isArray(p.capabilities)
			? (p.capabilities as unknown[]).filter((c): c is string => typeof c === "string")
			: [],
	};
	if (typeof p.description === "string") def.description = p.description;
	if (typeof p.icon === "string") def.icon = p.icon;
	if (isConcurrencyPolicy(p.concurrency)) def.concurrency = p.concurrency as ConcurrencyPolicy;
	if (Array.isArray(p.tags)) {
		def.tags = (p.tags as unknown[]).filter((t): t is string => typeof t === "string");
	}
	return def;
}

export function reminderToProperties(def: ReminderDef): Record<string, unknown> {
	const props: Record<string, unknown> = { subject: def.subject, dueAt: def.dueAt };
	if (def.target !== undefined) props.target = def.target;
	if (def.recurrence !== undefined) props.recurrence = def.recurrence;
	if (def.snoozedUntil !== undefined) props.snoozedUntil = def.snoozedUntil;
	if (def.completedAt !== undefined) props.completedAt = def.completedAt;
	return props;
}

export function propertiesToReminder(
	props: Record<string, unknown> | null | undefined,
): ReminderDef {
	const p = props ?? {};
	const def: ReminderDef = {
		subject: typeof p.subject === "string" ? p.subject : "",
		dueAt: typeof p.dueAt === "string" ? p.dueAt : "",
	};
	if (typeof p.target === "string") def.target = p.target;
	if (typeof p.recurrence === "string") def.recurrence = p.recurrence;
	if (typeof p.snoozedUntil === "string") def.snoozedUntil = p.snoozedUntil;
	if (typeof p.completedAt === "string") def.completedAt = p.completedAt;
	return def;
}

export function triggerToProperties(def: TriggerDef): Record<string, unknown> {
	const props: Record<string, unknown> = {
		kind: def.kind,
		config: def.config,
		enabled: def.enabled,
	};
	if (def.lastFiredAt !== undefined) props.lastFiredAt = def.lastFiredAt;
	if (def.nextFireAt !== undefined) props.nextFireAt = def.nextFireAt;
	return props;
}

export function propertiesToTrigger(props: Record<string, unknown> | null | undefined): TriggerDef {
	const p = props ?? {};
	const def: TriggerDef = {
		kind: isTriggerKind(p.kind) ? (p.kind as TriggerKind) : TriggerKind.Manual,
		config: p.config && typeof p.config === "object" ? (p.config as Record<string, unknown>) : {},
		enabled: p.enabled === true,
	};
	if (typeof p.lastFiredAt === "string") def.lastFiredAt = p.lastFiredAt;
	if (typeof p.nextFireAt === "string") def.nextFireAt = p.nextFireAt;
	return def;
}
