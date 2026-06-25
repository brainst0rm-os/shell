/**
 * Targeted single-row DOM patching for the task list.
 *
 * The hot path before this: every checkbox toggle / icon change / delete
 * tore down the entire surface (`contentSlot.replaceChildren(...)`) and
 * rebuilt EVERY row — O(N) `document.createElement`, O(N)
 * `createEntityIconElement`, plus (pre-delegation) O(N) listener attach —
 * for a one-task change. Non-virtualised lists made this quadratic under
 * the campaign dataset.
 *
 * This module patches ONLY the affected row in place when the mutation
 * doesn't change the visible set / order (the overwhelmingly common
 * case: toggling a task whose surface still shows completed items,
 * changing an icon, etc.). When the mutation DOES change which rows are
 * visible (completing a task while "Show completed" is off, deleting,
 * moving project), the caller falls back to a full structural render —
 * `sequenceChanged` decides which.
 *
 * Scroll position + focus are preserved across an in-place swap because
 * only one `<li>` subtree is replaced; the scroll container and every
 * other node are untouched. Focus that lived inside the replaced row is
 * restored onto the structurally-equivalent control in the new row.
 */

import { type TaskRowProps, renderTaskRow } from "./task-row";

const TASK_ID_SELECTOR = "[data-task-id]";

/** The ordered list of visible task ids the surface currently paints.
 *  A mutation is "structural" iff this sequence changes. */
export function visibleTaskIdSequence(container: ParentNode): string[] {
	const ids: string[] = [];
	for (const el of container.querySelectorAll<HTMLElement>(TASK_ID_SELECTOR)) {
		const id = el.dataset.taskId;
		if (id) ids.push(id);
	}
	return ids;
}

/** True when `next` differs from `prev` in membership or order — the
 *  caller must do a full render then. */
export function sequenceChanged(prev: readonly string[], next: readonly string[]): boolean {
	if (prev.length !== next.length) return true;
	for (let i = 0; i < prev.length; i++) {
		if (prev[i] !== next[i]) return true;
	}
	return false;
}

/** Which focusable control inside a row currently has focus, so it can
 *  be restored after the subtree swap. The row has three: the completion
 *  toggle, the icon button, the ⋯ overflow. */
type RowFocusKind =
	| "toggle"
	| "glyph"
	| "more"
	| "name-label"
	| "chip-priority"
	| "chip-date"
	| "chip-project"
	| null;

function focusedControl(row: Element): RowFocusKind {
	const active = row.ownerDocument?.activeElement;
	if (!active || !row.contains(active)) return null;
	if (active.classList.contains("task-row__toggle")) return "toggle";
	if (active.classList.contains("task-row__glyph")) return "glyph";
	if (active.classList.contains("task-row__more")) return "more";
	if (active.classList.contains("task-row__name-label")) return "name-label";
	if (active.classList.contains("task-row__chip--editable")) {
		const kind = (active as HTMLElement).dataset.kind;
		if (kind === "priority") return "chip-priority";
		if (kind === "date" || kind === "date-overdue") return "chip-date";
		if (kind === "project") return "chip-project";
	}
	return null;
}

function restoreFocus(row: HTMLElement, kind: RowFocusKind): void {
	if (!kind) return;
	const selector =
		kind === "toggle"
			? ".task-row__toggle"
			: kind === "glyph"
				? ".task-row__glyph"
				: kind === "more"
					? ".task-row__more"
					: kind === "name-label"
						? ".task-row__name-label"
						: kind === "chip-priority"
							? '.task-row__chip--editable[data-kind="priority"]'
							: kind === "chip-date"
								? '.task-row__chip--editable[data-kind^="date"]'
								: '.task-row__chip--editable[data-kind="project"]';
	row.querySelector<HTMLElement>(selector)?.focus();
}

/**
 * Replace exactly the `<li data-task-id={taskId}>` subtree with a freshly
 * rendered row for `props.task`. Returns true when the row was found and
 * swapped; false when it isn't on screen (caller then no-ops or falls
 * back). Focus inside the row is preserved across the swap.
 */
export function replaceTaskRowInPlace(
	container: ParentNode,
	taskId: string,
	props: TaskRowProps,
): boolean {
	const existing = container.querySelector<HTMLElement>(
		`${TASK_ID_SELECTOR}[data-task-id="${cssEscape(taskId)}"]`,
	);
	if (!existing) return false;
	const focus = focusedControl(existing);
	const fresh = renderTaskRow(props);
	// A targeted swap leaves membership + order unchanged, so the row keeps
	// its composite-keyboard slot. `renderTaskRow` doesn't stamp the index
	// (the list builder does), so carry it across so the roving cursor /
	// `role="option"` stamping the binding applied stays intact.
	if (existing.dataset.compositeIndex !== undefined) {
		fresh.dataset.compositeIndex = existing.dataset.compositeIndex;
	}
	if (existing.hasAttribute("role")) {
		const role = existing.getAttribute("role");
		if (role) fresh.setAttribute("role", role);
	}
	existing.replaceWith(fresh);
	restoreFocus(fresh, focus);
	return true;
}

/** Remove exactly the row for `taskId`. Returns true when a row was
 *  removed. Used by the optimistic delete path so a single deletion
 *  doesn't rebuild the list. The caller still does a full render when
 *  the deletion empties a section / surface (handled by the
 *  `sequenceChanged` guard upstream — a removed-then-empty surface needs
 *  its empty state). */
export function removeTaskRowInPlace(container: ParentNode, taskId: string): boolean {
	const existing = container.querySelector<HTMLElement>(
		`${TASK_ID_SELECTOR}[data-task-id="${cssEscape(taskId)}"]`,
	);
	if (!existing) return false;
	existing.remove();
	return true;
}

function cssEscape(value: string): string {
	if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
		return CSS.escape(value);
	}
	return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
