/**
 * Bundled "Journaling" template (Welcome-2 / 9.3.5.V 7d) — a starter set for
 * a daily journal: two dated `Entry/v1` entries (today + yesterday) plus a
 * prompts note to get going. A journal entry is identified by a strict
 * canonical `YYYY-MM-DD` title (see the journal app's `parseJournalDateKey`),
 * so the entry titles derive from `now` via `dayKey` — keeping the template
 * deterministic in `now`.
 */

import { type TemplateManifest, buildTemplateManifest } from "../template-codec";
import { DAY_MS, body, dayKey, text } from "./seed-body";

export const JOURNALING_TEMPLATE_ID = "journaling";

const ENTRY_TYPE = "io.brainstorm.journal/Entry/v1";
const NOTE_TYPE = "io.brainstorm.notes/Note/v1";

const ID = {
	today: "tmpl-jr-today",
	yesterday: "tmpl-jr-yesterday",
	prompts: "tmpl-jr-prompts",
} as const;

/** Build the Journaling template, stamped with `now`. */
export function buildJournalingTemplate(now: number): TemplateManifest {
	const ts = { createdAt: now, updatedAt: now };
	return buildTemplateManifest({
		id: JOURNALING_TEMPLATE_ID,
		name: "Journaling",
		description: "Two starter daily entries and a note of prompts to keep the habit going.",
		entities: [
			{
				id: ID.yesterday,
				type: ENTRY_TYPE,
				properties: { title: dayKey(now, -1), createdAt: now - DAY_MS, updatedAt: now - DAY_MS },
				body: body([[text("Yesterday, in three lines: what happened, what I learned, what's next.")]]),
			},
			{
				id: ID.today,
				type: ENTRY_TYPE,
				properties: { title: dayKey(now, 0), ...ts },
				body: body([[text("Today's entry — start writing here.")]]),
			},
			{
				id: ID.prompts,
				type: NOTE_TYPE,
				properties: { title: "Journaling prompts", ...ts },
				body: body([
					[text("Stuck? Try one of these:")],
					[text("• What went well today, and why?")],
					[text("• One thing I'm grateful for.")],
					[text("• What would make tomorrow better?")],
				]),
			},
		],
	});
}
