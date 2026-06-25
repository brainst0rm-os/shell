/**
 * Welcome-2 template registry (9.3.5.V 7d) — the single list of bundled vault
 * templates the first-launch gallery offers and the `welcome:import-template`
 * IPC handler resolves an id against. Each entry carries the gallery display
 * metadata (`name` / `description`, kept in sync with the built manifest by
 * the registry test) plus the deterministic `build(now)` authoring fn.
 *
 * Adding a template = author its `build…Template` module + add one entry here;
 * the gallery and the import path pick it up with no other wiring. Ids are the
 * stable per-vault import-stamp + parent-Collection keys, so they never change.
 */

import type { TemplateManifest } from "./template-codec";
import { JOURNALING_TEMPLATE_ID, buildJournalingTemplate } from "./templates/journaling";
import {
	PERSONAL_KNOWLEDGE_TEMPLATE_ID,
	buildPersonalKnowledgeTemplate,
} from "./templates/personal-knowledge";
import {
	PROJECT_MANAGEMENT_TEMPLATE_ID,
	buildProjectManagementTemplate,
} from "./templates/project-management";
import { RESEARCH_TEMPLATE_ID, buildResearchTemplate } from "./templates/research";
import { SMALL_BUSINESS_TEMPLATE_ID, buildSmallBusinessTemplate } from "./templates/small-business";
import { STUDY_TEMPLATE_ID, buildStudyTemplate } from "./templates/study";
import { WRITING_TEMPLATE_ID, buildWritingTemplate } from "./templates/writing";

export type TemplateRegistryEntry = {
	readonly id: string;
	/** Gallery display name (matches the built manifest's `name`). */
	readonly name: string;
	/** One-line gallery blurb (matches the built manifest's `description`). */
	readonly description: string;
	/** Build the manifest stamped with `now` (deterministic). */
	readonly build: (now: number) => TemplateManifest;
};

export const TEMPLATE_REGISTRY: readonly TemplateRegistryEntry[] = [
	{
		id: PROJECT_MANAGEMENT_TEMPLATE_ID,
		name: "Project management",
		description: "A project with tasks, a kickoff note, and a kickoff meeting.",
		build: buildProjectManagementTemplate,
	},
	{
		id: SMALL_BUSINESS_TEMPLATE_ID,
		name: "Small business",
		description: "Clients, a client project, follow-up tasks, and an operating overview.",
		build: buildSmallBusinessTemplate,
	},
	{
		id: RESEARCH_TEMPLATE_ID,
		name: "Research",
		description: "A thesis note, captured sources, and a literature-review task.",
		build: buildResearchTemplate,
	},
	{
		id: STUDY_TEMPLATE_ID,
		name: "Study",
		description: "A course hub, assignments with due dates, and an exam on the calendar.",
		build: buildStudyTemplate,
	},
	{
		id: PERSONAL_KNOWLEDGE_TEMPLATE_ID,
		name: "Personal knowledge",
		description: "A map-of-content hub and two interlinked atomic notes to grow from.",
		build: buildPersonalKnowledgeTemplate,
	},
	{
		id: WRITING_TEMPLATE_ID,
		name: "Writing",
		description: "A project outline and three chapter drafts to work through.",
		build: buildWritingTemplate,
	},
	{
		id: JOURNALING_TEMPLATE_ID,
		name: "Journaling",
		description: "Two starter daily entries and a note of prompts to keep the habit going.",
		build: buildJournalingTemplate,
	},
] as const;

/** All registered template ids, in gallery order. */
export const TEMPLATE_IDS: readonly string[] = TEMPLATE_REGISTRY.map((t) => t.id);

/** Resolve a registry entry by id, or `null` for an unknown id (the IPC
 *  handler fail-closes on this — never builds an arbitrary manifest). */
export function templateById(id: string): TemplateRegistryEntry | null {
	return TEMPLATE_REGISTRY.find((t) => t.id === id) ?? null;
}
