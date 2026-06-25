/**
 * Task detail route — the centered reading / editing surface the content area
 * shows when a task is opened (replacing the list), mirroring the Bookmarks
 * detail. Plain DOM except the body editor, which the app mounts into
 * `editorHost` as a React island (`inspector-editor-mount`). The properties
 * inspector is a separate `.bs-props` glass overlay toggled from the header —
 * it is NOT part of this view.
 *
 * The title + chips reuse the *same* builders the list rows use
 * (`task-row.ts`), so a task's title and properties behave identically in the
 * list and the detail — no duplicated chrome. Closing the route is the header
 * back button's job (the open task is part of the nav location), so this view
 * has no close affordance of its own.
 */

import type { Recurrence, RecurrenceSummaryLabels } from "@brainstorm/sdk-types";
import {
	type RecurrenceEditorLabels,
	createRecurrenceEditor,
} from "@brainstorm/sdk/recurrence-editor";
import { t } from "../i18n/t";
import { isPastDue } from "../logic/task-status";
import { formatMinutes, parseDurationToMinutes } from "../logic/task-time";
import type { Project } from "../types/project";
import type { Task, TaskComment } from "../types/task";
import {
	dateChip,
	priorityChip,
	projectChip,
	renderCompletionToggle,
	renderEditableName,
} from "./task-row";

export type TaskDetailViewProps = {
	task: Task;
	now: number;
	projectsById: ReadonlyMap<string, Project>;
	onToggleComplete(task: Task): void;
	onRenameTask(task: Task, name: string): void;
	onPickPriority(task: Task, anchor: HTMLElement): void;
	onPickDate(task: Task, anchor: HTMLElement): void;
	onPickProject(task: Task, anchor: HTMLElement): void;
	/** Direct child tasks (9.14.7). Omit (or empty) in preview / standalone
	 *  mode to hide the Subtasks section entirely. */
	subtasks?: readonly Task[];
	/** Open a child task's own detail route. */
	onOpenSubtask?(task: Task): void;
	/** Toggle a child task's completion (reuses the parent toggle handler shape). */
	onToggleSubtask?(task: Task): void;
	/** Create a new child task under this task with the given name. */
	onAddSubtask?(name: string): void;
	/** Incomplete tasks blocking this one (9.14.8). Omit/empty + no add
	 *  handler → the Blocked-by section is hidden. */
	blockedBy?: readonly Task[];
	/** Open a blocking task's own detail route. */
	onOpenDependency?(task: Task): void;
	/** Remove a blocker (the dependency id) from this task. */
	onRemoveDependency?(depId: string): void;
	/** Open the "add blocker" picker, anchored to the trigger button. */
	onAddDependency?(anchor: HTMLElement): void;
	/** Recurrence editing (9.14.12). When provided, a Repeat section mounts the
	 *  shared recurrence editor anchored on `anchor` (the task's due/scheduled/
	 *  created instant). `onChange` persists without forcing a detail re-render. */
	recurrence?: {
		value: Recurrence | null;
		anchor: number;
		labels: RecurrenceEditorLabels;
		summaryLabels: RecurrenceSummaryLabels;
		onChange(value: Recurrence | null): void;
	};
	/** Time estimate / logged effort (9.14.13). When provided, a Time section
	 *  shows two free-typed duration fields. `null` clears the field. */
	time?: {
		estimateMinutes: number | null;
		loggedMinutes: number | null;
		onChangeEstimate(minutes: number | null): void;
		onChangeLogged(minutes: number | null): void;
	};
	/** Tags (9.14.10). When provided, a Tags section shows removable chips +
	 *  an add field; clicking a chip filters by that tag. */
	tags?: {
		values: readonly string[];
		onAdd(tag: string): void;
		onRemove(tag: string): void;
		onClickTag(tag: string): void;
	};
	/** Comments / activity (9.14.14). When provided, a Comments section shows
	 *  the thread + an add field. */
	comments?: {
		values: readonly TaskComment[];
		onAdd(body: string): void;
		onRemove(id: string): void;
	};
};

export type TaskDetailView = {
	root: HTMLElement;
	/** The slot the app mounts the body editor (or the read-only fallback)
	 *  into. */
	editorHost: HTMLElement;
};

export function renderTaskDetailView(props: TaskDetailViewProps): TaskDetailView {
	const { task, now } = props;
	const done = task.completedAt !== null;
	const overdue = isPastDue(task, now);

	const root = document.createElement("section");
	root.className = "tasks-detail";
	root.dataset.taskId = task.id;
	root.setAttribute("aria-label", t("tasks.detail.region"));

	// Title row — completion toggle + editable title, reusing the list-row
	// builders so the title behaves identically here and in the list.
	const titleRow = document.createElement("div");
	titleRow.className = "tasks-detail__titlerow";
	const titleGroup = document.createElement("div");
	titleGroup.className = "tasks-detail__title-group";
	titleGroup.appendChild(renderCompletionToggle(task, done, props.onToggleComplete));
	titleGroup.appendChild(renderEditableName(task, props.onRenameTask, { singleClick: true }));
	titleRow.appendChild(titleGroup);
	root.appendChild(titleRow);

	// Property chips — the same editable chips the list rows carry, so
	// priority / date / project edits flow through the identical app handlers
	// and look identical in both places.
	const chips = document.createElement("div");
	chips.className = "tasks-detail__chips";
	chips.appendChild(priorityChip(task, (anchor) => props.onPickPriority(task, anchor)));
	chips.appendChild(dateChip(task, now, overdue, (anchor) => props.onPickDate(task, anchor)));
	chips.appendChild(
		projectChip(task, props.projectsById, (anchor) => props.onPickProject(task, anchor)),
	);
	root.appendChild(chips);

	const blockedSection = renderBlockedBySection(props);
	if (blockedSection) root.appendChild(blockedSection);

	const tagsSection = renderTagsSection(props);
	if (tagsSection) root.appendChild(tagsSection);

	const timeSection = renderTimeSection(props);
	if (timeSection) root.appendChild(timeSection);

	const recurrenceSection = renderRecurrenceSection(props);
	if (recurrenceSection) root.appendChild(recurrenceSection);

	const subtasksSection = renderSubtasksSection(props);
	if (subtasksSection) root.appendChild(subtasksSection);

	const editorHost = document.createElement("div");
	editorHost.className = "tasks-detail__body";
	root.appendChild(editorHost);

	const commentsSection = renderCommentsSection(props);
	if (commentsSection) root.appendChild(commentsSection);

	return { root, editorHost };
}

/** Comments / activity section (9.14.14) — an oldest-first thread + an add box.
 *  Sits below the body editor. */
function renderCommentsSection(props: TaskDetailViewProps): HTMLElement | null {
	const config = props.comments;
	if (!config) return null;
	const section = document.createElement("section");
	section.className = "tasks-detail__comments";
	section.setAttribute("aria-label", t("tasks.comments.region"));

	const header = document.createElement("div");
	header.className = "tasks-detail__subtasks-header";
	const heading = document.createElement("h2");
	heading.className = "tasks-detail__subtasks-title";
	heading.textContent = t("tasks.comments.heading");
	header.appendChild(heading);
	section.appendChild(header);

	const thread = document.createElement("ul");
	thread.className = "tasks-detail__comment-list";
	for (const comment of config.values) {
		thread.appendChild(renderComment(comment, config.onRemove));
	}
	section.appendChild(thread);

	const form = document.createElement("form");
	form.className = "tasks-detail__comment-add";
	const textarea = document.createElement("textarea");
	textarea.className = "tasks-detail__comment-input";
	textarea.rows = 2;
	textarea.placeholder = t("tasks.comments.addPlaceholder");
	textarea.setAttribute("aria-label", t("tasks.comments.addPlaceholder"));
	const submit = document.createElement("button");
	submit.type = "submit";
	submit.className = "tasks-detail__comment-submit";
	submit.textContent = t("tasks.comments.post");
	form.append(textarea, submit);
	form.addEventListener("submit", (e) => {
		e.preventDefault();
		const body = textarea.value.trim();
		if (body.length === 0) return;
		config.onAdd(body);
		textarea.value = "";
		textarea.focus();
	});
	section.appendChild(form);
	return section;
}

function renderComment(comment: TaskComment, onRemove: (id: string) => void): HTMLElement {
	const item = document.createElement("li");
	item.className = "tasks-detail__comment";
	item.dataset.commentId = comment.id;
	const meta = document.createElement("div");
	meta.className = "tasks-detail__comment-meta";
	const when = document.createElement("span");
	when.className = "tasks-detail__comment-time";
	when.textContent = new Date(comment.at).toLocaleString();
	const remove = document.createElement("button");
	remove.type = "button";
	remove.className = "tasks-detail__comment-remove";
	remove.textContent = "✕";
	remove.setAttribute("aria-label", t("tasks.comments.remove"));
	remove.addEventListener("click", () => onRemove(comment.id));
	meta.append(when, remove);
	const body = document.createElement("p");
	body.className = "tasks-detail__comment-body";
	body.textContent = comment.body;
	item.append(meta, body);
	return item;
}

/** Subtasks section (9.14.7) — a progress-headed list of child tasks with an
 *  inline "add subtask" field. Returns `null` when no subtask handlers are
 *  wired (preview / standalone) so the section never shows an inert affordance. */
function renderSubtasksSection(props: TaskDetailViewProps): HTMLElement | null {
	if (!props.onAddSubtask && !props.onOpenSubtask) return null;
	const children = props.subtasks ?? [];
	const progress = {
		done: children.filter((c) => c.completedAt !== null).length,
		total: children.length,
	};

	const section = document.createElement("section");
	section.className = "tasks-detail__subtasks";
	section.setAttribute("aria-label", t("tasks.subtasks.region"));

	const header = document.createElement("div");
	header.className = "tasks-detail__subtasks-header";
	const heading = document.createElement("h2");
	heading.className = "tasks-detail__subtasks-title";
	heading.textContent = t("tasks.subtasks.heading");
	header.appendChild(heading);
	if (progress.total > 0) {
		const count = document.createElement("span");
		count.className = "tasks-detail__subtasks-count";
		count.textContent = t("tasks.subtasks.progress", {
			done: progress.done,
			total: progress.total,
		});
		header.appendChild(count);
	}
	section.appendChild(header);

	const list = document.createElement("ul");
	list.className = "tasks-detail__subtasks-list";
	for (const child of children) {
		list.appendChild(renderSubtaskRow(child, props));
	}
	section.appendChild(list);

	if (props.onAddSubtask) {
		section.appendChild(renderAddSubtask(props.onAddSubtask));
	}
	return section;
}

function renderSubtaskRow(child: Task, props: TaskDetailViewProps): HTMLElement {
	const item = document.createElement("li");
	item.className = "tasks-detail__subtask";
	item.dataset.taskId = child.id;
	const childDone = child.completedAt !== null;
	if (childDone) item.dataset.done = "true";
	if (props.onToggleSubtask) {
		item.appendChild(renderCompletionToggle(child, childDone, props.onToggleSubtask));
	}
	const name = document.createElement("button");
	name.type = "button";
	name.className = "tasks-detail__subtask-name";
	name.textContent = child.name;
	if (props.onOpenSubtask) {
		name.addEventListener("click", () => props.onOpenSubtask?.(child));
	} else {
		name.disabled = true;
	}
	item.appendChild(name);
	return item;
}

function renderAddSubtask(onAddSubtask: (name: string) => void): HTMLElement {
	const form = document.createElement("form");
	form.className = "tasks-detail__subtask-add";
	const input = document.createElement("input");
	input.type = "text";
	input.className = "tasks-detail__subtask-add-input";
	input.placeholder = t("tasks.subtasks.addPlaceholder");
	input.setAttribute("aria-label", t("tasks.subtasks.addPlaceholder"));
	form.appendChild(input);
	form.addEventListener("submit", (e) => {
		e.preventDefault();
		const name = input.value.trim();
		if (name.length === 0) return;
		onAddSubtask(name);
		input.value = "";
		input.focus();
	});
	return form;
}

/** Tags section (9.14.10) — removable tag chips + an add field; clicking a
 *  chip filters by that tag. */
function renderTagsSection(props: TaskDetailViewProps): HTMLElement | null {
	const config = props.tags;
	if (!config) return null;
	const section = document.createElement("section");
	section.className = "tasks-detail__tags";
	section.setAttribute("aria-label", t("tasks.tags.region"));

	const header = document.createElement("div");
	header.className = "tasks-detail__subtasks-header";
	const heading = document.createElement("h2");
	heading.className = "tasks-detail__subtasks-title";
	heading.textContent = t("tasks.tags.heading");
	header.appendChild(heading);
	section.appendChild(header);

	const list = document.createElement("div");
	list.className = "tasks-detail__tag-list";
	for (const tag of config.values) {
		const chip = document.createElement("span");
		chip.className = "tasks-detail__tag";
		const label = document.createElement("button");
		label.type = "button";
		label.className = "tasks-detail__tag-label";
		label.textContent = tag;
		label.addEventListener("click", () => config.onClickTag(tag));
		const remove = document.createElement("button");
		remove.type = "button";
		remove.className = "tasks-detail__tag-remove";
		remove.textContent = "✕";
		remove.setAttribute("aria-label", t("tasks.tags.remove"));
		remove.addEventListener("click", () => config.onRemove(tag));
		chip.append(label, remove);
		list.appendChild(chip);
	}
	section.appendChild(list);

	const form = document.createElement("form");
	form.className = "tasks-detail__tag-add";
	const input = document.createElement("input");
	input.type = "text";
	input.className = "tasks-detail__tag-add-input";
	input.placeholder = t("tasks.tags.addPlaceholder");
	input.setAttribute("aria-label", t("tasks.tags.addPlaceholder"));
	form.appendChild(input);
	form.addEventListener("submit", (e) => {
		e.preventDefault();
		const value = input.value.trim();
		if (value.length === 0) return;
		config.onAdd(value);
		input.value = "";
		input.focus();
	});
	section.appendChild(form);
	return section;
}

/** Time section (9.14.13) — Estimate + Logged free-typed duration fields. */
function renderTimeSection(props: TaskDetailViewProps): HTMLElement | null {
	const config = props.time;
	if (!config) return null;
	const section = document.createElement("section");
	section.className = "tasks-detail__time";
	section.setAttribute("aria-label", t("tasks.time.region"));

	const header = document.createElement("div");
	header.className = "tasks-detail__subtasks-header";
	const heading = document.createElement("h2");
	heading.className = "tasks-detail__subtasks-title";
	heading.textContent = t("tasks.time.heading");
	header.appendChild(heading);
	section.appendChild(header);

	section.appendChild(
		durationField(t("tasks.time.estimate"), config.estimateMinutes, config.onChangeEstimate),
	);
	section.appendChild(
		durationField(t("tasks.time.logged"), config.loggedMinutes, config.onChangeLogged),
	);
	return section;
}

function durationField(
	label: string,
	minutes: number | null,
	onChange: (minutes: number | null) => void,
): HTMLElement {
	const row = document.createElement("label");
	row.className = "tasks-detail__time-row";
	const span = document.createElement("span");
	span.className = "tasks-detail__time-label";
	span.textContent = label;
	const input = document.createElement("input");
	input.type = "text";
	input.className = "tasks-detail__time-input";
	input.value = formatMinutes(minutes);
	input.placeholder = "2h 30m";
	input.setAttribute("aria-label", label);
	const commit = (): void => {
		const trimmed = input.value.trim();
		const next = trimmed.length === 0 ? null : parseDurationToMinutes(trimmed);
		// An unparseable entry reverts to the last good value rather than persisting.
		if (trimmed.length > 0 && next === null) {
			input.value = formatMinutes(minutes);
			return;
		}
		if (next !== minutes) onChange(next);
		input.value = formatMinutes(next);
	};
	input.addEventListener("blur", commit);
	// Enter commits this editable <input>; the shortcut registry suppresses
	// single keys in editable fields by design.
	// keyboard-exempt
	input.addEventListener("keydown", (e) => {
		// keyboard-exempt
		if (e.key === "Enter") {
			e.preventDefault();
			input.blur();
		}
	});
	row.append(span, input);
	return row;
}

/** Repeat section (9.14.12) — mounts the shared recurrence editor. Recreated
 *  per render from the task's current recurrence; the host wires `onChange` to
 *  a no-detail-refresh persist so mid-interaction edits don't rebuild it. */
function renderRecurrenceSection(props: TaskDetailViewProps): HTMLElement | null {
	const config = props.recurrence;
	if (!config) return null;
	const section = document.createElement("section");
	section.className = "tasks-detail__recurrence";
	section.setAttribute("aria-label", t("tasks.recurrence.region"));

	const header = document.createElement("div");
	header.className = "tasks-detail__subtasks-header";
	const heading = document.createElement("h2");
	heading.className = "tasks-detail__subtasks-title";
	heading.textContent = t("tasks.recurrence.heading");
	header.appendChild(heading);
	section.appendChild(header);

	const editor = createRecurrenceEditor({
		value: config.value,
		start: config.anchor,
		labels: config.labels,
		summaryLabels: config.summaryLabels,
		onChange: config.onChange,
	});
	section.appendChild(editor.element);
	return section;
}

/** Blocked-by section (9.14.8) — lists the incomplete tasks blocking this one,
 *  each removable, plus an "Add blocker" trigger. Hidden when there are no
 *  blockers and no add handler (preview / standalone). */
function renderBlockedBySection(props: TaskDetailViewProps): HTMLElement | null {
	if (!props.onAddDependency && !props.onRemoveDependency) return null;
	const blockers = props.blockedBy ?? [];
	const section = document.createElement("section");
	section.className = "tasks-detail__blockedby";
	section.setAttribute("aria-label", t("tasks.dependencies.region"));

	const header = document.createElement("div");
	header.className = "tasks-detail__subtasks-header";
	const heading = document.createElement("h2");
	heading.className = "tasks-detail__subtasks-title";
	heading.textContent = t("tasks.dependencies.heading");
	header.appendChild(heading);
	if (blockers.length > 0) {
		const badge = document.createElement("span");
		badge.className = "tasks-detail__blocked-flag";
		badge.textContent = t("tasks.dependencies.blocked");
		header.appendChild(badge);
	}
	section.appendChild(header);

	const list = document.createElement("ul");
	list.className = "tasks-detail__subtasks-list";
	for (const blocker of blockers) {
		const item = document.createElement("li");
		item.className = "tasks-detail__subtask";
		item.dataset.taskId = blocker.id;
		const name = document.createElement("button");
		name.type = "button";
		name.className = "tasks-detail__subtask-name";
		name.textContent = blocker.name;
		if (props.onOpenDependency) {
			name.addEventListener("click", () => props.onOpenDependency?.(blocker));
		} else {
			name.disabled = true;
		}
		item.appendChild(name);
		if (props.onRemoveDependency) {
			const remove = document.createElement("button");
			remove.type = "button";
			remove.className = "tasks-detail__dep-remove";
			remove.textContent = "✕";
			remove.setAttribute("aria-label", t("tasks.dependencies.remove"));
			remove.addEventListener("click", () => props.onRemoveDependency?.(blocker.id));
			item.appendChild(remove);
		}
		list.appendChild(item);
	}
	section.appendChild(list);

	if (props.onAddDependency) {
		const add = document.createElement("button");
		add.type = "button";
		add.className = "tasks-detail__dep-add";
		add.textContent = t("tasks.dependencies.add");
		add.addEventListener("click", () => props.onAddDependency?.(add));
		section.appendChild(add);
	}
	return section;
}

/** Read-only legacy-notes fallback for preview / standalone mode (no editor
 *  mount). Mirrors Journal's read-only paragraph fallback. */
export function renderLegacyNotesFallback(notes: string): HTMLElement {
	const p = document.createElement("p");
	p.className = "tasks-detail__legacy-notes";
	p.textContent = notes;
	return p;
}
