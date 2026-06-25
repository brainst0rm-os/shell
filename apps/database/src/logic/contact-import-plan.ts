/**
 * Contact-import dedupe + commit-plan keystone (9.12.16, second slice).
 * Pure: given parsed `PersonDraft[]` (from `contact-import.ts`) and the
 * vault's existing Person rows, decide per-row whether each incoming
 * contact is a duplicate (→ default **Merge**), brand-new (→ **Create**),
 * and produce the merged-property preview the UI shows before commit.
 * The UI may override any row to Create / Merge / Skip; `commandsFor`
 * turns the (possibly overridden) plan into the create/update command
 * list the thin caller hands to the entities service. No DOM, no
 * entities service, no file I/O — that wiring layers on top and is
 * swapped freely; this is the long-term contract.
 */

import type { PersonDraft } from "./contact-import";

export enum ImportAction {
	Create = "create",
	Merge = "merge",
	Skip = "skip",
}

/** Minimal shape of an existing Person — only what matching/merging
 *  needs, so this module doesn't depend on `EntityRow` internals. */
export type ExistingPerson = { id: string; properties: Record<string, unknown> };

export type ImportPlanRow = {
	draft: PersonDraft;
	/** The default decision: Merge when a duplicate was found, else Create.
	 *  The UI presents this and may override per row. */
	action: ImportAction;
	/** Existing entity id when a duplicate was detected, else null. */
	matchId: string | null;
	/** Preview of the property bag a Merge would write (existing ∪ draft).
	 *  Null when there is no match. */
	merged: Record<string, unknown> | null;
};

export type ImportCommand =
	| { op: "create"; properties: Record<string, unknown> }
	| { op: "update"; id: string; properties: Record<string, unknown> };

function norm(s: unknown): string {
	return typeof s === "string" ? s.trim().toLowerCase().replace(/\s+/g, " ") : "";
}

function asStringArray(v: unknown): string[] {
	if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
	return typeof v === "string" && v ? [v] : [];
}

/** Case-insensitive union for emails, exact-trim union for phones —
 *  order-stable: existing values first, then new ones not already present. */
function unionList(existing: string[], incoming: string[], caseInsensitive: boolean): string[] {
	const seen = new Set(existing.map((e) => (caseInsensitive ? e.toLowerCase() : e).trim()));
	const out = [...existing];
	for (const v of incoming) {
		const key = (caseInsensitive ? v.toLowerCase() : v).trim();
		if (key && !seen.has(key)) {
			seen.add(key);
			out.push(v);
		}
	}
	return out;
}

/** Bag of catalog properties a draft contributes (omits absent fields). */
export function draftToProps(draft: PersonDraft): Record<string, unknown> {
	const p: Record<string, unknown> = { name: draft.name };
	if (draft.email?.length) p.email = draft.email;
	if (draft.phone?.length) p.phone = draft.phone;
	if (draft.company) p.company = draft.company;
	if (draft.role) p.role = draft.role;
	if (typeof draft.birthday === "number") p.birthday = draft.birthday;
	return p;
}

/** A draft duplicates an existing Person when any email matches
 *  (case-insensitive) or, failing that, the normalized display name is
 *  equal. Email is the strong key; name is the fallback. First match
 *  wins (stable input order). */
export function findDuplicate(
	draft: PersonDraft,
	existing: ReadonlyArray<ExistingPerson>,
): ExistingPerson | null {
	const draftEmails = new Set((draft.email ?? []).map((e) => e.trim().toLowerCase()));
	if (draftEmails.size > 0) {
		for (const e of existing) {
			if (asStringArray(e.properties.email).some((x) => draftEmails.has(x.trim().toLowerCase()))) {
				return e;
			}
		}
	}
	const dn = norm(draft.name);
	if (dn) {
		for (const e of existing) {
			if (norm(e.properties.name) === dn) return e;
		}
	}
	return null;
}

/** Existing bag ∪ draft: union email/phone lists; fill scalar fields
 *  (company/role/birthday) only when the existing value is absent; never
 *  overwrite the existing display name (a curated value the user may
 *  have edited). The result is the full property bag a Merge writes. */
export function mergePersonProps(
	existing: Record<string, unknown>,
	draft: PersonDraft,
): Record<string, unknown> {
	const merged: Record<string, unknown> = { ...existing };
	const email = unionList(asStringArray(existing.email), draft.email ?? [], true);
	const phone = unionList(asStringArray(existing.phone), draft.phone ?? [], false);
	if (email.length) merged.email = email;
	if (phone.length) merged.phone = phone;
	if (!merged.company && draft.company) merged.company = draft.company;
	if (!merged.role && draft.role) merged.role = draft.role;
	if (merged.birthday == null && typeof draft.birthday === "number") {
		merged.birthday = draft.birthday;
	}
	if (!norm(merged.name) && draft.name) merged.name = draft.name;
	return merged;
}

export function planImport(
	drafts: ReadonlyArray<PersonDraft>,
	existing: ReadonlyArray<ExistingPerson>,
): ImportPlanRow[] {
	return drafts.map((draft) => {
		const match = findDuplicate(draft, existing);
		if (!match) {
			return { draft, action: ImportAction.Create, matchId: null, merged: null };
		}
		return {
			draft,
			action: ImportAction.Merge,
			matchId: match.id,
			merged: mergePersonProps(match.properties, draft),
		};
	});
}

/** Resolve the (possibly UI-overridden) plan to entities-service
 *  commands. A row overridden to Create always inserts a new entity even
 *  if a duplicate was detected; Merge requires a `matchId` (falls back to
 *  Create when somehow absent); Skip emits nothing.
 *
 *  `propertyOverrides` (slice-2 per-row preview grid) layers per-field
 *  edits onto a row's resolved bag — keyed by plan index, shallow-merged
 *  over `draftToProps` for a Create or over the merged bag for a Merge.
 *  A patch follows whichever action the row resolves to (so editing a
 *  field then toggling Create→Merge still applies the edit). */
export function commandsFor(
	plan: ReadonlyArray<ImportPlanRow>,
	overrides: Readonly<Record<number, ImportAction>> = {},
	propertyOverrides: Readonly<Record<number, Record<string, unknown>>> = {},
): ImportCommand[] {
	const out: ImportCommand[] = [];
	plan.forEach((row, i) => {
		const action = overrides[i] ?? row.action;
		if (action === ImportAction.Skip) return;
		const patch = propertyOverrides[i];
		if (action === ImportAction.Merge && row.matchId) {
			const base = row.merged ?? mergePersonProps({}, row.draft);
			out.push({
				op: "update",
				id: row.matchId,
				properties: patch ? { ...base, ...patch } : base,
			});
			return;
		}
		const base = draftToProps(row.draft);
		out.push({ op: "create", properties: patch ? { ...base, ...patch } : base });
	});
	return out;
}

/** One-line counts for the preview header ("3 new · 2 merge · 1 skip"). */
export function summarize(
	plan: ReadonlyArray<ImportPlanRow>,
	overrides: Readonly<Record<number, ImportAction>> = {},
): { create: number; merge: number; skip: number } {
	const c = { create: 0, merge: 0, skip: 0 };
	plan.forEach((row, i) => {
		const action = overrides[i] ?? row.action;
		if (action === ImportAction.Create) c.create++;
		else if (action === ImportAction.Merge) c.merge++;
		else c.skip++;
	});
	return c;
}
