/**
 * Pattern templates (9.13.14) — curated starting-point `GraphPattern`s the
 * Templates menu offers, replacing the long-removed hardcoded preset list
 * with a vault-aware one: a template is offered enabled only when at least
 * one of the entity types it binds actually exists in the snapshot (an
 * empty canvas is a worse answer than a disabled row with a hint).
 *
 * Templates are deliberately edge-free where possible: subjects bind the
 * node groups and the renderer already draws every live link among matched
 * nodes, so "Notes & journal" needs no edge constraint to show the link
 * structure — same philosophy as `localScope`'s "true connectivity" rule.
 */

import type { GraphI18nKey } from "../i18n/manifest";
import type { GraphPattern } from "../types/pattern";
import type { InMemoryGraph } from "./in-memory-graph";
import { defaultPattern, makeSubject } from "./pattern-edit";

export enum PatternTemplateId {
	Everything = "everything",
	Notes = "notes",
	Work = "work",
	People = "people",
	Library = "library",
}

/** Entity-type URLs the templates bind. Wire ids — byte-identical to the
 *  owning apps' manifests. */
const NOTE_TYPE = "io.brainstorm.notes/Note/v1";
const JOURNAL_TYPE = "io.brainstorm.journal/Entry/v1";
const TASK_TYPE = "brainstorm/Task/v1";
const PROJECT_TYPE = "brainstorm/Project/v1";
const PERSON_TYPE = "brainstorm/Person/v1";
const COMPANY_TYPE = "brainstorm/Company/v1";
const FILE_TYPE = "brainstorm/File/v1";
const FOLDER_TYPE = "brainstorm/Folder/v1";
const BOOKMARK_TYPE = "brainstorm/Bookmark/v1";

export type PatternTemplate = {
	id: PatternTemplateId;
	/** i18n key for the menu row label. */
	nameKey: GraphI18nKey;
	/** Types the template binds — enabled when ≥1 exists in the vault.
	 *  Empty = always available (the Everything template). */
	bindsTypes: readonly string[];
	build(): GraphPattern;
};

function twoSubjects(
	a: { name: string; types: string[] },
	b: { name: string; types: string[] },
): GraphPattern {
	return {
		subjects: {
			S1: makeSubject(a.name, a.types),
			S2: makeSubject(b.name, b.types),
		},
		edges: [],
		primarySubject: "S1",
	};
}

export const PATTERN_TEMPLATES: readonly PatternTemplate[] = [
	{
		id: PatternTemplateId.Everything,
		nameKey: "templates.everything",
		bindsTypes: [],
		build: defaultPattern,
	},
	{
		id: PatternTemplateId.Notes,
		nameKey: "templates.notes",
		bindsTypes: [NOTE_TYPE, JOURNAL_TYPE],
		build: () =>
			twoSubjects({ name: "Notes", types: [NOTE_TYPE] }, { name: "Journal", types: [JOURNAL_TYPE] }),
	},
	{
		id: PatternTemplateId.Work,
		nameKey: "templates.work",
		bindsTypes: [TASK_TYPE, PROJECT_TYPE],
		build: () =>
			twoSubjects({ name: "Tasks", types: [TASK_TYPE] }, { name: "Projects", types: [PROJECT_TYPE] }),
	},
	{
		id: PatternTemplateId.People,
		nameKey: "templates.people",
		bindsTypes: [PERSON_TYPE, COMPANY_TYPE],
		build: () =>
			twoSubjects(
				{ name: "People", types: [PERSON_TYPE] },
				{ name: "Companies", types: [COMPANY_TYPE] },
			),
	},
	{
		id: PatternTemplateId.Library,
		nameKey: "templates.library",
		bindsTypes: [FILE_TYPE, FOLDER_TYPE, BOOKMARK_TYPE],
		build: () => ({
			subjects: {
				S1: makeSubject("Folders", [FOLDER_TYPE]),
				S2: makeSubject("Files", [FILE_TYPE]),
				S3: makeSubject("Bookmarks", [BOOKMARK_TYPE]),
			},
			edges: [],
			primarySubject: "S1",
		}),
	},
];

/** Distinct live entity types in the snapshot. */
export function presentTypeSet(db: InMemoryGraph): ReadonlySet<string> {
	const out = new Set<string>();
	for (const e of db.entities) {
		if (e.deletedAt === null) out.add(e.type);
	}
	return out;
}

/** A template is offered enabled when it binds no specific types (always)
 *  or at least one of its bound types exists in the vault. */
export function templateAvailable(
	template: PatternTemplate,
	presentTypes: ReadonlySet<string>,
): boolean {
	if (template.bindsTypes.length === 0) return true;
	return template.bindsTypes.some((type) => presentTypes.has(type));
}
