/**
 * 9.12.16-UI slice 2 — pure model for the per-row import preview grid.
 *
 * Slice 1 shipped a count-only confirmation ("3 new · 2 merge"). This
 * is the data layer behind the row-by-row grid: it turns the contacts
 * `ImportPlanRow[]` into a display model the imperative modal renders,
 * and owns the three slice-2 affordances as pure functions:
 *
 *   - **toggle the per-row action** (`nextAction` cycles Create→Skip or,
 *     for a matched row, Merge→Create→Skip),
 *   - **edit the merged property bag** (`formatPreviewValue` /
 *     `parsePreviewValue` round-trip a field's value through a text
 *     input; `isEditableValue` gates which fields are editable),
 *   - **see the existing-row diff inline** (`buildPreviewRow.diff` pairs
 *     the matched entity's current value with the merge result).
 *
 * Built against the concrete `ImportPlanRow` (contacts) — the only
 * importable type today. The action-override + property-override wire
 * format stays generic in `commandsFor`, so when a second mapper lands
 * the grid generalises by teaching the mapper to describe its own rows;
 * abstracting that now (one mapper) would be premature.
 *
 * No DOM — the modal in `ui/import-flow.ts` renders this; tests drive it
 * directly.
 */

import { ImportAction, type ImportPlanRow, draftToProps } from "./contact-import-plan";

/** One row of the preview grid, derived from a plan row. */
export type PreviewRow = {
	/** Plan index — the override maps key off this. */
	index: number;
	/** Display title (the `name` field, or a placeholder). */
	title: string;
	/** The plan's default decision; the UI starts here and may override. */
	defaultAction: ImportAction;
	/** A duplicate was detected (Merge is offered). */
	hasMatch: boolean;
	matchId: string | null;
	/** The editable property bag — `draftToProps` for a Create, the
	 *  merged bag for a Merge. Drives both the field list and the edits. */
	fields: PreviewField[];
	/** For a Merge: existing value → merged value, per key. Empty for a
	 *  Create (nothing to diff against). */
	diff: PreviewDiffRow[];
};

export type PreviewField = {
	key: string;
	label: string;
	/** Display string (lists joined by "; "). */
	value: string;
	/** Inline-editable in the grid (strings + string lists). Numbers,
	 *  booleans and structured values are shown read-only in v1. */
	editable: boolean;
	/** The value is a string list — the modal edits it as a "; "-joined
	 *  field and `parsePreviewValue` splits it back. */
	isList: boolean;
};

export type PreviewDiffRow = {
	key: string;
	label: string;
	before: string;
	after: string;
	/** The merge changes this property (drives the highlight). */
	changed: boolean;
};

/** Render a property value as the grid's display string. Lists join with
 *  "; "; numbers/booleans stringify; null/undefined collapse to empty;
 *  anything structured falls back to JSON so the cell never shows
 *  `[object Object]`. */
export function formatPreviewValue(value: unknown): string {
	if (value == null) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
	if (typeof value === "boolean") return value ? "yes" : "no";
	if (Array.isArray(value)) {
		return value.filter((v) => typeof v === "string" && v.trim() !== "").join("; ");
	}
	return JSON.stringify(value);
}

/** A field is inline-editable when it's a string or a list of strings —
 *  the two shapes a single text input round-trips cleanly. */
export function isEditableValue(value: unknown): boolean {
	if (typeof value === "string") return true;
	if (Array.isArray(value)) return value.every((v) => typeof v === "string");
	return false;
}

/** Parse a text-input string back to the property value. `sample` is the
 *  field's current value, used only to decide list vs scalar — a list
 *  splits on commas/semicolons (trimmed, blanks dropped); a scalar trims.
 *  Editing a field to blank yields `""` / `[]`, which the commit path
 *  shallow-merges over the base bag (an intentional clear). */
export function parsePreviewValue(input: string, sample: unknown): string | string[] {
	if (Array.isArray(sample)) {
		return input
			.split(/[;,]/)
			.map((s) => s.trim())
			.filter((s) => s !== "");
	}
	return input.trim();
}

/** Cycle a row's action on each toggle click. An unmatched row has no
 *  Merge target, so it flips Create⇄Skip; a matched row rotates
 *  Merge→Create→Skip→Merge (Merge first because it's the safe default —
 *  no duplicate entity). */
export function nextAction(current: ImportAction, hasMatch: boolean): ImportAction {
	if (!hasMatch) {
		return current === ImportAction.Create ? ImportAction.Skip : ImportAction.Create;
	}
	switch (current) {
		case ImportAction.Merge:
			return ImportAction.Create;
		case ImportAction.Create:
			return ImportAction.Skip;
		default:
			return ImportAction.Merge;
	}
}

/** Short verb for the action badge. */
export function actionVerb(action: ImportAction): string {
	switch (action) {
		case ImportAction.Create:
			return "New";
		case ImportAction.Merge:
			return "Merge";
		default:
			return "Skip";
	}
}

/** Build one preview row from a plan row. `existingById` resolves the
 *  matched entity's current bag for the diff; `labelOf` humanizes a
 *  property key (injected so this module stays free of the UI's
 *  `humanize`). */
export function buildPreviewRow(
	row: ImportPlanRow,
	index: number,
	existingById: ReadonlyMap<string, Record<string, unknown>>,
	labelOf: (key: string) => string,
): PreviewRow {
	const isMerge = row.action === ImportAction.Merge && row.matchId !== null;
	const bag = isMerge && row.merged ? row.merged : draftToProps(row.draft);
	const fields: PreviewField[] = Object.entries(bag).map(([key, value]) => ({
		key,
		label: labelOf(key),
		value: formatPreviewValue(value),
		editable: isEditableValue(value),
		isList: Array.isArray(value),
	}));
	const titleRaw = formatPreviewValue(bag.name);
	const title = titleRaw !== "" ? titleRaw : "(untitled)";

	let diff: PreviewDiffRow[] = [];
	if (isMerge && row.merged && row.matchId) {
		const existing = existingById.get(row.matchId) ?? {};
		diff = Object.entries(row.merged).map(([key, after]) => {
			const before = formatPreviewValue(existing[key]);
			const afterStr = formatPreviewValue(after);
			return { key, label: labelOf(key), before, after: afterStr, changed: before !== afterStr };
		});
	}

	return {
		index,
		title,
		defaultAction: row.action,
		hasMatch: row.matchId !== null,
		matchId: row.matchId,
		fields,
		diff,
	};
}

/** Build the full grid model. `existing` is the same dedupe snapshot the
 *  plan was built from; it's indexed once for the per-row diff lookup. */
export function buildPreviewRows(
	plan: ReadonlyArray<ImportPlanRow>,
	existing: ReadonlyArray<{ id: string; properties: Record<string, unknown> }>,
	labelOf: (key: string) => string,
): PreviewRow[] {
	const byId = new Map<string, Record<string, unknown>>();
	for (const e of existing) byId.set(e.id, e.properties);
	return plan.map((row, i) => buildPreviewRow(row, i, byId, labelOf));
}
