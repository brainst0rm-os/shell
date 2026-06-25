/**
 * Bundled "Study" template (Welcome-2 / 9.3.5.V 7d) — a starter set for a
 * student: a course-hub note, two assignment tasks with due dates, and an
 * exam event. The hub note `@`-mentions the assignments + the exam so the
 * Graph paints the course as a connected cluster. Deterministic in `now`.
 */

import { type TemplateManifest, buildTemplateManifest } from "../template-codec";
import { DAY_MS, body, mention, text } from "./seed-body";

export const STUDY_TEMPLATE_ID = "study";

const NOTE_TYPE = "io.brainstorm.notes/Note/v1";
const TASK_TYPE = "brainstorm/Task/v1";
const EVENT_TYPE = "brainstorm/Event/v1";

const ID = {
	hub: "tmpl-st-course-hub",
	task1: "tmpl-st-reading",
	task2: "tmpl-st-essay",
	exam: "tmpl-st-exam",
} as const;

/** Build the Study template, stamped with `now`. */
export function buildStudyTemplate(now: number): TemplateManifest {
	const ts = { createdAt: now, updatedAt: now };
	const task = (id: string, name: string, dueInDays: number) => ({
		id,
		type: TASK_TYPE,
		properties: { name, statusKey: "todo", priority: "high", dueAt: now + dueInDays * DAY_MS, ...ts },
	});

	return buildTemplateManifest({
		id: STUDY_TEMPLATE_ID,
		name: "Study",
		description: "A course hub, assignments with due dates, and an exam on the calendar.",
		entities: [
			task(ID.task1, "Read chapters 1–3", 4),
			task(ID.task2, "Draft the term essay", 14),
			{
				id: ID.exam,
				type: EVENT_TYPE,
				properties: {
					title: "Midterm exam",
					start: now + 21 * DAY_MS,
					end: now + 21 * DAY_MS,
					...ts,
				},
			},
			{
				id: ID.hub,
				type: NOTE_TYPE,
				properties: { title: "Course hub", ...ts },
				body: body([
					[
						text("This term: "),
						mention(ID.task1, TASK_TYPE, "Read chapters 1–3"),
						text(" and "),
						mention(ID.task2, TASK_TYPE, "Draft the term essay"),
						text("."),
					],
					[text("Goal: be ready for the "), mention(ID.exam, EVENT_TYPE, "Midterm exam"), text(".")],
				]),
			},
		],
	});
}
