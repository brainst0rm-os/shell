/**
 * Bundled "Research" template (Welcome-2 / 9.3.5.V 7d) — a starter set for a
 * research project: a thesis note, two captured source bookmarks, and a
 * literature-review task. The thesis note `@`-mentions the sources + the task
 * so the Graph shows the research web. Deterministic in `now`.
 */

import { type TemplateManifest, buildTemplateManifest } from "../template-codec";
import { DAY_MS, body, mention, text } from "./seed-body";

export const RESEARCH_TEMPLATE_ID = "research";

const NOTE_TYPE = "io.brainstorm.notes/Note/v1";
const BOOKMARK_TYPE = "brainstorm/Bookmark/v1";
const TASK_TYPE = "brainstorm/Task/v1";

const ID = {
	thesis: "tmpl-rs-thesis",
	source1: "tmpl-rs-source-survey",
	source2: "tmpl-rs-source-method",
	task: "tmpl-rs-litreview",
} as const;

/** Build the Research template, stamped with `now`. */
export function buildResearchTemplate(now: number): TemplateManifest {
	const ts = { createdAt: now, updatedAt: now };
	const bookmark = (id: string, title: string, url: string) => ({
		id,
		type: BOOKMARK_TYPE,
		properties: { url, title, tags: ["source"], savedAt: now, ...ts },
	});

	return buildTemplateManifest({
		id: RESEARCH_TEMPLATE_ID,
		name: "Research",
		description: "A thesis note, captured sources, and a literature-review task.",
		entities: [
			bookmark(ID.source1, "Field survey (overview)", "https://example.org/survey"),
			bookmark(ID.source2, "Methods reference", "https://example.org/methods"),
			{
				id: ID.task,
				type: TASK_TYPE,
				properties: {
					name: "Write the literature review",
					statusKey: "todo",
					priority: "high",
					dueAt: now + 10 * DAY_MS,
					...ts,
				},
			},
			{
				id: ID.thesis,
				type: NOTE_TYPE,
				properties: { title: "Research thesis", ...ts },
				body: body([
					[text("Thesis: state the question and the expected contribution here.")],
					[
						text("Sources: "),
						mention(ID.source1, BOOKMARK_TYPE, "Field survey (overview)"),
						text(" and "),
						mention(ID.source2, BOOKMARK_TYPE, "Methods reference"),
						text("."),
					],
					[text("Next: "), mention(ID.task, TASK_TYPE, "Write the literature review"), text(".")],
				]),
			},
		],
	});
}
