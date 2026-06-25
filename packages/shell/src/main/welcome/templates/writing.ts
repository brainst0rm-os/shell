/**
 * Bundled "Writing" template (Welcome-2 / 9.3.5.V 7d) — a starter set for a
 * writing project: an outline note plus three chapter tasks. The outline
 * `@`-mentions each chapter so the Graph paints the manuscript structure.
 * Deterministic in `now`.
 */

import { type TemplateManifest, buildTemplateManifest } from "../template-codec";
import { DAY_MS, body, mention, text } from "./seed-body";

export const WRITING_TEMPLATE_ID = "writing";

const NOTE_TYPE = "io.brainstorm.notes/Note/v1";
const TASK_TYPE = "brainstorm/Task/v1";

const ID = {
	outline: "tmpl-wr-outline",
	ch1: "tmpl-wr-ch1",
	ch2: "tmpl-wr-ch2",
	ch3: "tmpl-wr-ch3",
} as const;

/** Build the Writing template, stamped with `now`. */
export function buildWritingTemplate(now: number): TemplateManifest {
	const ts = { createdAt: now, updatedAt: now };
	const chapter = (id: string, name: string, dueInDays: number) => ({
		id,
		type: TASK_TYPE,
		properties: {
			name,
			statusKey: "todo",
			priority: "medium",
			dueAt: now + dueInDays * DAY_MS,
			...ts,
		},
	});

	return buildTemplateManifest({
		id: WRITING_TEMPLATE_ID,
		name: "Writing",
		description: "A project outline and three chapter drafts to work through.",
		entities: [
			chapter(ID.ch1, "Draft chapter 1", 7),
			chapter(ID.ch2, "Draft chapter 2", 14),
			chapter(ID.ch3, "Draft chapter 3", 21),
			{
				id: ID.outline,
				type: NOTE_TYPE,
				properties: { title: "Outline", ...ts },
				body: body([
					[text("The arc, chapter by chapter:")],
					[text("1. "), mention(ID.ch1, TASK_TYPE, "Draft chapter 1")],
					[text("2. "), mention(ID.ch2, TASK_TYPE, "Draft chapter 2")],
					[text("3. "), mention(ID.ch3, TASK_TYPE, "Draft chapter 3")],
				]),
			},
		],
	});
}
