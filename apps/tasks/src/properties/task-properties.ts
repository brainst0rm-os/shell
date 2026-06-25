/**
 * Task properties bridge (interim, pre-property-backed entity). A task's
 * read-only-at-a-glance attributes — status, priority, schedule, project,
 * timestamps — are surfaced through the shared property-value cells
 * (`@brainstorm/sdk/property-ui`) rather than hand-rolled rows
 * ([[feedback-no-hand-rolled-property-panels]]), exactly like the Bookmarks
 * detail.
 *
 * Tasks still store these as first-class `Task` fields, so this module
 * BRIDGES: it synthesises a `PropertyDef` list + a `ValuesMap` from the typed
 * fields for the detail's properties inspector. The rows are display-only —
 * editing a task's priority / date / project happens through the detail's
 * chips (the same chips the list rows carry), so the panel stays a clean
 * summary. When the OQ-DM-1 property-backed migration lands (a task becomes a
 * property-bearing entity with a real `values` map) the synthesis drops out
 * and the same cells render the entity's own values — zero UI change. The defs
 * are transient (not registered in the vault catalog) so the global Properties
 * list isn't polluted with field-bridge entries.
 */

import { DateGranularity, type PropertyDef, ValueType } from "@brainstorm/sdk-types";
import type { ValuesMap } from "@brainstorm/sdk/property-ui";
import { t } from "../i18n/t";
import type { Task } from "../types/task";

/** The vault type the assignee picker is scoped to — the same people the
 *  Contacts app holds. */
export const PERSON_ENTITY_TYPE = "brainstorm/Person/v1";

export const TASK_PROP_KEY = {
	status: "io.brainstorm.tasks/status",
	priority: "io.brainstorm.tasks/priority",
	scheduled: "io.brainstorm.tasks/scheduled",
	due: "io.brainstorm.tasks/due",
	project: "io.brainstorm.tasks/project",
	assignee: "io.brainstorm.tasks/assignee",
	created: "io.brainstorm.tasks/created",
	updated: "io.brainstorm.tasks/updated",
} as const;

/** Render order for the detail's properties inspector. Display-only except
 *  Assignee (an editable Person/v1 entity-ref picker, F-152) — priority /
 *  date / project editing lives in the detail's chips. */
export const TASK_PROPERTY_DEFS: readonly PropertyDef[] = [
	{ key: TASK_PROP_KEY.status, name: t("tasks.prop.status"), icon: null, valueType: ValueType.Text },
	{
		key: TASK_PROP_KEY.priority,
		name: t("tasks.prop.priority"),
		icon: null,
		valueType: ValueType.Text,
	},
	{
		key: TASK_PROP_KEY.scheduled,
		name: t("tasks.prop.scheduled"),
		icon: null,
		valueType: ValueType.Date,
		granularity: DateGranularity.Date,
	},
	{
		key: TASK_PROP_KEY.due,
		name: t("tasks.prop.due"),
		icon: null,
		valueType: ValueType.Date,
		granularity: DateGranularity.Date,
	},
	{
		key: TASK_PROP_KEY.project,
		name: t("tasks.prop.project"),
		icon: null,
		valueType: ValueType.Text,
	},
	{
		key: TASK_PROP_KEY.assignee,
		name: t("tasks.prop.assignee"),
		icon: null,
		valueType: ValueType.EntityRef,
		allowedTypes: [PERSON_ENTITY_TYPE],
		count: { min: 0, max: 1 },
	},
	{
		key: TASK_PROP_KEY.created,
		name: t("tasks.prop.created"),
		icon: null,
		valueType: ValueType.Date,
		granularity: DateGranularity.Date,
	},
	{
		key: TASK_PROP_KEY.updated,
		name: t("tasks.prop.updated"),
		icon: null,
		valueType: ValueType.Date,
		granularity: DateGranularity.Date,
	},
];

/** Resolved human labels the app supplies (priority / project / status read
 *  from `t()` + the project map, which this pure module can't reach). */
export type TaskValueContext = {
	priorityLabel: string;
	projectName: string;
	statusLabel: string;
};

/** Synthesise the cell values for a task, keyed by property def. A null/absent
 *  date renders as an empty date cell. The assignee cell takes the raw ref id —
 *  the shared Link cell resolves the display title from the live snapshot. */
export function taskToValues(task: Task, ctx: TaskValueContext): ValuesMap {
	return {
		[TASK_PROP_KEY.status]: ctx.statusLabel,
		[TASK_PROP_KEY.priority]: ctx.priorityLabel,
		[TASK_PROP_KEY.scheduled]:
			task.scheduledAt !== null ? { at: task.scheduledAt, granularity: DateGranularity.Date } : null,
		[TASK_PROP_KEY.due]:
			task.dueAt !== null ? { at: task.dueAt, granularity: DateGranularity.Date } : null,
		[TASK_PROP_KEY.project]: ctx.projectName,
		[TASK_PROP_KEY.assignee]: task.assigneeId ?? "",
		[TASK_PROP_KEY.created]: { at: task.createdAt, granularity: DateGranularity.Date },
		[TASK_PROP_KEY.updated]: { at: task.updatedAt, granularity: DateGranularity.Date },
	};
}

/** Map the assignee cell's edited value back to the stored ref id — the
 *  scalar Link cell emits the picked entity id, or an empty/null clear. */
export function parseAssigneeValue(next: unknown): string | null {
	return typeof next === "string" && next.length > 0 ? next : null;
}

/** Catalog defs bound on the task (a key in `values` that resolves in the
 *  vault catalog), name-sorted — the editable custom rows (9.14.16). A key
 *  whose def was deleted from the catalog renders nothing (the value stays
 *  in the bag untouched). */
export function boundCustomDefs(
	values: ValuesMap | undefined,
	catalog: ReadonlyMap<string, PropertyDef>,
): PropertyDef[] {
	if (!values) return [];
	const out: PropertyDef[] = [];
	for (const key of Object.keys(values)) {
		const def = catalog.get(key);
		if (def) out.push(def);
	}
	out.sort((a, b) => a.name.localeCompare(b.name));
	return out;
}

/** Catalog defs not yet bound on the task — the add-property menu's
 *  candidates, name-sorted. Excludes keys already in `values` AND the
 *  fixed/bridged catalog keys shown as their own dedicated rows: `assigneeId`
 *  is the F-152 catalog def the app ensures at boot, and binding it into
 *  `values` would create a second, divergent "Assignee" the chip / group-by /
 *  Graph edge ignore (they read `task.assigneeId`). */
export function unboundCustomDefs(
	values: ValuesMap | undefined,
	catalog: ReadonlyMap<string, PropertyDef>,
): PropertyDef[] {
	const bound = new Set(Object.keys(values ?? {}));
	const fixed = new Set([ASSIGNEE_CATALOG_DEF.key]);
	const out: PropertyDef[] = [];
	for (const def of catalog.values()) {
		if (!bound.has(def.key) && !fixed.has(def.key)) out.push(def);
	}
	out.sort((a, b) => a.name.localeCompare(b.name));
	return out;
}

/** The vault-catalog EntityRef def for `Task.assigneeId` (F-152) — the def
 *  the shell's catalog-driven derivation reads to project the Task→Person
 *  "Assignee" edge into the Graph. Key + shape mirror the dev seeder
 *  (`plan-properties.ts`), but the app ensures it itself at boot because the
 *  seeder only runs under AUTO_SEED (never in a production vault). The name
 *  is catalog data (persisted), not UI chrome — deliberately not t()'d,
 *  matching every other catalog def. */
export const ASSIGNEE_CATALOG_DEF: PropertyDef = {
	key: "assigneeId",
	name: "Assignee",
	icon: null,
	valueType: ValueType.EntityRef,
	allowedTypes: [PERSON_ENTITY_TYPE],
	count: { min: 0, max: 1 },
};
