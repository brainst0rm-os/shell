/**
 * Journal entry templates & writing prompts (9.16.5).
 *
 * A template is a small ordered set of sections that seed a *new* entry's
 * body with structure the user would otherwise type every day — a Daily
 * Review's three questions, a gratitude prompt, a free-write nudge. The
 * picker shows on an empty today; choosing one plants the seed state into
 * the entry's Y.Doc through the same `pendingSeed` path the blank
 * placeholder uses.
 *
 * This module is pure + i18n-agnostic: the structure (which sections, in
 * what order) lives in `JOURNAL_TEMPLATE_SPECS` as i18n keys; `app.ts`
 * resolves the keys through `t()` and hands the resolved `JournalTemplate`
 * to `templateToSeedState`, which builds the Lexical `SerializedEditorState`.
 * Headings become `h2` nodes (registered in the editor's BASELINE_NODES);
 * an optional prompt becomes a muted quote line; each section ends with an
 * empty paragraph to write into.
 */

import type { SerializedEditorState } from "lexical";
import type { JournalI18nKey } from "./journal-i18n";

export type TemplateSection = {
	/** Section heading — rendered as an `h2`. Empty string → no heading
	 *  (free-write templates that are just a prompt + blank space). */
	heading: string;
	/** Optional guidance line rendered as a muted quote under the heading.
	 *  Omitted → the section is just a heading + empty paragraph. */
	prompt?: string;
};

export type JournalTemplate = {
	id: string;
	name: string;
	sections: TemplateSection[];
};

/** Declarative template structure with i18n keys — text is resolved in
 *  `app.ts` via `t()` so no user-visible string is hardcoded here. */
export type TemplateSpec = {
	id: string;
	nameKey: JournalI18nKey;
	sections: ReadonlyArray<{ headingKey?: JournalI18nKey; promptKey?: JournalI18nKey }>;
};

export const JOURNAL_TEMPLATE_SPECS: readonly TemplateSpec[] = Object.freeze([
	{
		id: "daily-review",
		nameKey: "template.dailyReview",
		sections: [
			{ headingKey: "template.dailyReview.well" },
			{ headingKey: "template.dailyReview.hard" },
			{ headingKey: "template.dailyReview.tomorrow" },
		],
	},
	{
		id: "gratitude",
		nameKey: "template.gratitude",
		sections: [{ headingKey: "template.gratitude.heading", promptKey: "template.gratitude.prompt" }],
	},
	{
		id: "free-write",
		nameKey: "template.freeWrite",
		sections: [{ promptKey: "template.freeWrite.prompt" }],
	},
]);

const TEXT_NODE_BASE = { format: 0, version: 1, style: "", mode: "normal", detail: 0 } as const;
const BLOCK_NODE_BASE = { format: "", indent: 0, version: 1, direction: null } as const;

function textNode(text: string): unknown {
	return { type: "text", text, ...TEXT_NODE_BASE };
}

function emptyParagraph(): unknown {
	return { type: "paragraph", children: [], ...BLOCK_NODE_BASE };
}

/** Build the Lexical `SerializedEditorState` for a template. Each section
 *  contributes (heading?) + (prompt-as-quote?) + one empty paragraph; a
 *  template with no sections yields a single empty paragraph (identical to
 *  the blank-entry seed). */
export function templateToSeedState(template: JournalTemplate): SerializedEditorState {
	const children: unknown[] = [];
	for (const section of template.sections) {
		if (section.heading) {
			children.push({
				type: "heading",
				tag: "h2",
				children: [textNode(section.heading)],
				...BLOCK_NODE_BASE,
			});
		}
		if (section.prompt) {
			children.push({
				type: "quote",
				children: [textNode(section.prompt)],
				...BLOCK_NODE_BASE,
			});
		}
		children.push(emptyParagraph());
	}
	if (children.length === 0) children.push(emptyParagraph());
	return {
		root: { type: "root", children, ...BLOCK_NODE_BASE },
	} as unknown as SerializedEditorState;
}
