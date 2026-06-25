/**
 * `intent.compose` payload → a fresh `Task`. Pure so the Notes `/task`
 * slash path (which dispatches `compose` with a free-text name and maybe
 * a project / scheduled date) round-trips through a unit test without a
 * renderer or storage. The DOM compose form (`ui/compose-view.ts`) only
 * collects a name + optional project; everything else is defaulted here.
 *
 * The id is caller-supplied so a test is deterministic; `app.ts` passes
 * a `crypto.randomUUID()`-derived id. Timestamps are caller-supplied for
 * the same reason (the app passes its `nowAnchor()`).
 */

import { Priority, type Task } from "../types/task";

/** The slice of an inbound `compose` intent payload Tasks understands.
 *  Unknown keys are ignored — a future richer payload stays compatible. */
export type ComposeTaskInput = {
	name: string;
	projectId?: string | null;
	/** Parent task id when composing a subtask (9.14.7). */
	parentId?: string | null;
	scheduledAt?: number | null;
	dueAt?: number | null;
	notes?: string;
	priority?: Priority;
	/** Status to materialise on the new task (the board's per-column add,
	 *  F-207). Default null — list capture flows stay statusless and the
	 *  board buckets them presentationally. */
	statusKey?: string | null;
};

export type ComposeTaskOptions = {
	id: string;
	now: number;
};

/** Parse an opaque intent payload into a `ComposeTaskInput`, or `null`
 *  when there's no usable task name (a compose with no subject is a
 *  no-op, not an empty task). */
export function parseComposePayload(payload: Record<string, unknown>): ComposeTaskInput | null {
	const rawName = payload.name ?? payload.title;
	const name = typeof rawName === "string" ? rawName.trim() : "";
	if (name.length === 0) return null;

	const input: ComposeTaskInput = { name };
	if (typeof payload.projectId === "string") input.projectId = payload.projectId;
	if (typeof payload.scheduledAt === "number") input.scheduledAt = payload.scheduledAt;
	if (typeof payload.dueAt === "number") input.dueAt = payload.dueAt;
	if (typeof payload.notes === "string") input.notes = payload.notes;
	return input;
}

export function composeTask(input: ComposeTaskInput, options: ComposeTaskOptions): Task {
	const { id, now } = options;
	return {
		id,
		name: input.name,
		...(input.notes !== undefined ? { notes: input.notes } : {}),
		icon: null,
		completedAt: null,
		priority: input.priority ?? Priority.None,
		scheduledAt: input.scheduledAt ?? null,
		dueAt: input.dueAt ?? null,
		projectId: input.projectId ?? null,
		assigneeId: null,
		parentId: input.parentId ?? null,
		recurrence: null,
		statusKey: input.statusKey ?? null,
		createdAt: now,
		updatedAt: now,
	};
}
