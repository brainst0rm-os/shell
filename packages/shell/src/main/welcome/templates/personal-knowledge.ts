/**
 * Bundled "Personal knowledge" template (Welcome-2 / 9.3.5.V 7d) — a small
 * Zettelkasten starter: three interlinked notes (a map-of-content hub + two
 * atomic notes) that `@`-mention each other so the Graph immediately shows a
 * connected knowledge web. Deterministic in `now`.
 */

import { type TemplateManifest, buildTemplateManifest } from "../template-codec";
import { body, mention, text } from "./seed-body";

export const PERSONAL_KNOWLEDGE_TEMPLATE_ID = "personal-knowledge";

const NOTE_TYPE = "io.brainstorm.notes/Note/v1";

const ID = {
	hub: "tmpl-pk-moc",
	atom1: "tmpl-pk-atom-spacing",
	atom2: "tmpl-pk-atom-linking",
} as const;

/** Build the Personal-knowledge template, stamped with `now`. */
export function buildPersonalKnowledgeTemplate(now: number): TemplateManifest {
	const ts = { createdAt: now, updatedAt: now };
	return buildTemplateManifest({
		id: PERSONAL_KNOWLEDGE_TEMPLATE_ID,
		name: "Personal knowledge",
		description: "A map-of-content hub and two interlinked atomic notes to grow from.",
		entities: [
			{
				id: ID.atom1,
				type: NOTE_TYPE,
				properties: { title: "Spaced repetition", ...ts },
				body: body([
					[text("Review at growing intervals to move ideas into long-term memory.")],
					[text("See also "), mention(ID.atom2, NOTE_TYPE, "Atomic linking"), text(".")],
				]),
			},
			{
				id: ID.atom2,
				type: NOTE_TYPE,
				properties: { title: "Atomic linking", ...ts },
				body: body([
					[text("Keep each note to one idea; link liberally so the web does the thinking.")],
					[text("Pairs with "), mention(ID.atom1, NOTE_TYPE, "Spaced repetition"), text(".")],
				]),
			},
			{
				id: ID.hub,
				type: NOTE_TYPE,
				properties: { title: "Map of content", ...ts },
				body: body([
					[text("Start here. Two notes to build on:")],
					[
						mention(ID.atom1, NOTE_TYPE, "Spaced repetition"),
						text(" · "),
						mention(ID.atom2, NOTE_TYPE, "Atomic linking"),
					],
				]),
			},
		],
	});
}
