/**
 * Bundled "Small business" template (Welcome-2 / 9.3.5.V 7d) — a starter set
 * for running a small business: two clients (`Person/v1`), a client project,
 * two follow-up tasks, and an operating-overview note whose body `@`-mentions
 * the project + a client so the Graph paints the relationships. Authored as a
 * `TemplateManifest`; deterministic in `now`.
 */

import { type TemplateManifest, buildTemplateManifest } from "../template-codec";
import { DAY_MS, body, mention, text } from "./seed-body";

export const SMALL_BUSINESS_TEMPLATE_ID = "small-business";

const PERSON_TYPE = "brainstorm/Person/v1";
const PROJECT_TYPE = "brainstorm/Project/v1";
const TASK_TYPE = "brainstorm/Task/v1";
const NOTE_TYPE = "io.brainstorm.notes/Note/v1";

const ID = {
	client1: "tmpl-sb-client-acme",
	client2: "tmpl-sb-client-globex",
	project: "tmpl-sb-project",
	task1: "tmpl-sb-task-invoice",
	task2: "tmpl-sb-task-followup",
	note: "tmpl-sb-overview",
} as const;

/** Build the Small business template, stamped with `now`. */
export function buildSmallBusinessTemplate(now: number): TemplateManifest {
	const ts = { createdAt: now, updatedAt: now };
	const task = (id: string, name: string, dueInDays: number) => ({
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
		id: SMALL_BUSINESS_TEMPLATE_ID,
		name: "Small business",
		description: "Clients, a client project, follow-up tasks, and an operating overview.",
		entities: [
			{
				id: ID.client1,
				type: PERSON_TYPE,
				properties: { name: "Acme Co.", email: ["hello@acme.example"], company: "Acme Co.", ...ts },
			},
			{
				id: ID.client2,
				type: PERSON_TYPE,
				properties: { name: "Globex", email: ["team@globex.example"], company: "Globex", ...ts },
			},
			{
				id: ID.project,
				type: PROJECT_TYPE,
				properties: { name: "Acme website refresh", statusKey: "active", ...ts },
			},
			task(ID.task1, "Send the kickoff invoice", 3),
			task(ID.task2, "Follow up with Globex", 7),
			{
				id: ID.note,
				type: NOTE_TYPE,
				properties: { title: "Business overview", ...ts },
				body: body([
					[
						text("Active engagement: "),
						mention(ID.project, PROJECT_TYPE, "Acme website refresh"),
						text(" for "),
						mention(ID.client1, PERSON_TYPE, "Acme Co."),
						text("."),
					],
					[
						text("Next: "),
						mention(ID.task1, TASK_TYPE, "Send the kickoff invoice"),
						text(", then "),
						mention(ID.task2, TASK_TYPE, "Follow up with Globex"),
						text("."),
					],
				]),
			},
		],
	});
}
