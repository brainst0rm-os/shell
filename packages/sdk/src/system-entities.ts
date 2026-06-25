/**
 * System (plumbing) entity types — vault rows the PRODUCT writes to make
 * apps work (saved views, automation machinery, session/persistence and
 * sync-ledger records) rather than knowledge the user authored. Surfaces
 * that enumerate "every type in the vault" (the Database sidebar's derived
 * type-lists, the Graph SHOW filter, future search facets) use this to
 * group or de-emphasise plumbing away from the user's content (F-212): a
 * BrowsingHistory ledger is not a thing Mira made. Presentation-only —
 * nothing here may change query or filtering semantics.
 *
 * Membership rule: a type belongs here when the user never *creates* one
 * deliberately — it exists as a side effect of using an app. Reminders,
 * StylePacks, Tasks, Notes are deliberate creations with their own
 * management UX and MUST NOT be listed.
 */

export const SystemEntityType = {
	BrowsingHistory: "brainstorm/BrowsingHistory/v1",
	BrowsingSession: "brainstorm/BrowsingSession/v1",
	GraphExport: "brainstorm/graph-export/v1",
	ListView: "brainstorm/ListView/v1",
	ShortcutBindings: "brainstorm/ShortcutBindings/v1",
	SyncRun: "brainstorm/SyncRun/v1",
	Trigger: "brainstorm/Trigger/v1",
	Workflow: "brainstorm/Workflow/v1",
	WorkflowRun: "brainstorm/WorkflowRun/v1",
} as const;

export type SystemEntityType = (typeof SystemEntityType)[keyof typeof SystemEntityType];

export const SYSTEM_ENTITY_TYPES: ReadonlySet<string> = new Set(Object.values(SystemEntityType));

export function isSystemEntityType(entityType: string): boolean {
	return SYSTEM_ENTITY_TYPES.has(entityType);
}

function pluralize(word: string): string {
	if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
	if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
	return `${word}s`;
}

/**
 * A human, pluralised label for a vault entity-type id — `brainstorm/Task/v1`
 * → `Tasks`. Drops a trailing `vN` version segment only when one is actually
 * present (so a version-less `brainstorm/Task` keeps `Task`, not the
 * `brainstorm` namespace), normalises `_`/`-` to spaces, and title-cases the
 * leading character. Shared by every surface that enumerates vault types
 * (Database sidebar, Calendar source filters, …).
 */
export function friendlyTypeName(typeId: string): string {
	const parts = typeId.split("/").filter((p) => p.length > 0);
	const last = parts[parts.length - 1];
	const hasVersion = last !== undefined && /^v\d+$/i.test(last);
	let name = hasVersion ? parts[parts.length - 2] : last;
	if (!name) return typeId;
	name = name.replace(/[_-]+/g, " ").trim();
	if (!name) return typeId;
	const titled = name.charAt(0).toUpperCase() + name.slice(1);
	return pluralize(titled);
}
