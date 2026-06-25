/**
 * SchedulerFiresRepository — CRUD on `registry.db.scheduler_fires`.
 *
 * The durable backing for the automations `SchedulerService` (11b.2): one
 * row per registered time trigger so the fire schedule survives a shell
 * restart. The service hydrates its in-memory heap from `loadAll()` on
 * boot and `save()`s after every register / re-arm so a crash between a
 * fire and its reschedule can't lose or double-fire the trigger.
 *
 * `workflowIds` and `config` are stored as JSON — the structured
 * `TimeTriggerConfig` (a `Recurrence` and/or one-shot instant) is opaque to
 * SQL; only `nextFireAt` is a queryable column (so the boot path could ask
 * "what's the earliest armed fire" without parsing every config).
 */

import type { TimeTriggerConfig } from "../../automations/trigger-schedule";
import type { SqliteDatabase } from "../sqlite";

/** The durable shape of one registered trigger (mirrors `PersistedFire`). */
export type SchedulerFireRecord = {
	triggerId: string;
	workflowIds: string[];
	config: TimeTriggerConfig;
	nextFireAt: number | null;
};

type SchedulerFireRow = {
	trigger_id: string;
	workflow_ids: string;
	config: string;
	next_fire_at: number | null;
};

export class SchedulerFiresRepository {
	constructor(private readonly db: SqliteDatabase) {}

	/** Insert or replace a trigger's row (register / re-arm are both upserts —
	 *  a re-registered trigger id overwrites its prior schedule). */
	save(fire: SchedulerFireRecord): void {
		this.db
			.prepare(
				`INSERT INTO scheduler_fires (trigger_id, workflow_ids, config, next_fire_at)
				VALUES (?, ?, ?, ?)
				ON CONFLICT(trigger_id) DO UPDATE SET
					workflow_ids = excluded.workflow_ids,
					config = excluded.config,
					next_fire_at = excluded.next_fire_at`,
			)
			.run(
				fire.triggerId,
				JSON.stringify(fire.workflowIds),
				JSON.stringify(fire.config),
				fire.nextFireAt,
			);
	}

	remove(triggerId: string): number {
		const result = this.db.prepare("DELETE FROM scheduler_fires WHERE trigger_id = ?").run(triggerId);
		return Number(result.changes);
	}

	/** Every registered trigger, in stable id order — the boot-hydration set. */
	listAll(): SchedulerFireRecord[] {
		const rows = this.db
			.prepare(
				"SELECT trigger_id, workflow_ids, config, next_fire_at FROM scheduler_fires ORDER BY trigger_id",
			)
			.all() as SchedulerFireRow[];
		return rows.map(fromRow);
	}
}

function fromRow(r: SchedulerFireRow): SchedulerFireRecord {
	return {
		triggerId: r.trigger_id,
		workflowIds: JSON.parse(r.workflow_ids) as string[],
		config: JSON.parse(r.config) as TimeTriggerConfig,
		nextFireAt: r.next_fire_at,
	};
}
