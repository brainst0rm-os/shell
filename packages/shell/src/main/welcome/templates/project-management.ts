/**
 * Bundled "Project management" template (Welcome-2 / 9.3.5.V 7d) — a curated
 * starter set for running a project: one Project, three Tasks, a kickoff Note
 * (its body `@`-mentions the project + tasks so the Graph paints a non-trivial
 * subgraph), and a kickoff Event. Authored as a `TemplateManifest` through the
 * 7d codec; `importTemplate` merges it under a parent Collection on import.
 *
 * Deterministic in `now` (no `Date.now()`), like `buildWelcomeStarterSet`:
 * the same `now` yields byte-identical output. The body-authoring helpers are
 * the small JSON builders the welcome content uses; kept local here (trivial
 * builders) rather than coupling to the welcome module — if a third bundled
 * template lands they extract to a shared `seed-body`.
 */

import { type TemplateManifest, buildTemplateManifest } from "../template-codec";
import { DAY_MS, body, mention, text } from "./seed-body";

export const PROJECT_MANAGEMENT_TEMPLATE_ID = "project-management";

const PROJECT_TYPE = "brainstorm/Project/v1";
const TASK_TYPE = "brainstorm/Task/v1";
const NOTE_TYPE = "io.brainstorm.notes/Note/v1";
const EVENT_TYPE = "brainstorm/Event/v1";

const ID = {
	project: "tmpl-pm-project",
	task1: "tmpl-pm-task-charter",
	task2: "tmpl-pm-task-milestones",
	task3: "tmpl-pm-task-retro",
	note: "tmpl-pm-kickoff",
	event: "tmpl-pm-kickoff-meeting",
} as const;

/** Build the Project management template, stamped with `now`. */
export function buildProjectManagementTemplate(now: number): TemplateManifest {
	const ts = { createdAt: now, updatedAt: now };
	const task = (id: string, name: string, statusKey: string, dueInDays: number) => ({
		id,
		type: TASK_TYPE,
		properties: { name, statusKey, priority: "medium", dueAt: now + dueInDays * DAY_MS, ...ts },
	});

	return buildTemplateManifest({
		id: PROJECT_MANAGEMENT_TEMPLATE_ID,
		name: "Project management",
		description: "A project with tasks, a kickoff note, and a kickoff meeting.",
		entities: [
			{
				id: ID.project,
				type: PROJECT_TYPE,
				properties: { name: "New project", statusKey: "active", ...ts },
			},
			task(ID.task1, "Write the project charter", "todo", 3),
			task(ID.task2, "Set milestones", "todo", 7),
			task(ID.task3, "Schedule the retro", "todo", 30),
			{
				id: ID.note,
				type: NOTE_TYPE,
				properties: { title: "Kickoff plan", ...ts },
				body: body([
					[
						text("Kickoff for "),
						mention(ID.project, PROJECT_TYPE, "New project"),
						text(". First up: "),
						mention(ID.task1, TASK_TYPE, "Write the project charter"),
						text(" and "),
						mention(ID.task2, TASK_TYPE, "Set milestones"),
						text("."),
					],
					[text("Close out with "), mention(ID.task3, TASK_TYPE, "Schedule the retro"), text(".")],
				]),
			},
			{
				id: ID.event,
				type: EVENT_TYPE,
				properties: { title: "Kickoff meeting", start: now + DAY_MS, end: now + DAY_MS, ...ts },
			},
		],
	});
}
