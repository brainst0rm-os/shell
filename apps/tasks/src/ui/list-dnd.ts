/**
 * Native-HTML5 drag-and-drop reordering for a flat `<ul>` whose
 * children carry a stable `data-${idAttr}` id. Shared by the sidebar's
 * active-projects list and the Inbox / Project surface task lists.
 *
 * Wires four listeners on `list`:
 *   - `dragstart` — captures the dragged id + paints `--dragging`
 *   - `dragover`  — paints `--drop-above` / `--drop-below` markers
 *   - `dragleave` — clears markers when the pointer truly leaves the list
 *   - `drop`      — derives the new ordering + fires `onReorder` once
 *   - `dragend`   — final cleanup (also fires when the drop is cancelled)
 *
 * Pure DOM + a single callback — no state outside the closure, no
 * dependency on the rest of the app. Callers re-bind the listeners on
 * every list rebuild (cheap: 4 listeners per render).
 */

export type WireListDndOptions = {
	/** The `<ul>` (or other container) holding the row elements. */
	list: HTMLElement;
	/** Name of the `data-` attribute that identifies each row.
	 *  E.g. `"projectId"` → `data-project-id`, `"taskId"` → `data-task-id`. */
	idAttr: "projectId" | "taskId";
	/** Class prefix used for the drop / dragging markers. Per-list so the
	 *  same CSS selectors don't bleed across the sidebar + task lists. */
	classPrefix: string;
	/** Called once after the drop with the new ordering of row ids
	 *  (top → bottom). The caller renumbers + persists. Not called when
	 *  the drop lands on the same slot (no-op move). */
	onReorder(orderedIds: string[]): void;
};

/** Compute the new ordering: move `draggedId` immediately before
 *  `targetId`, or to the end if `targetId === null`. Pure — used by both
 *  the live DnD path and direct unit tests. */
export function applyReorder(
	current: readonly string[],
	draggedId: string,
	targetId: string | null,
): string[] {
	const fromIdx = current.indexOf(draggedId);
	if (fromIdx < 0) return [...current];
	const without = current.filter((id) => id !== draggedId);
	if (targetId === null) return [...without, draggedId];
	const toIdx = without.indexOf(targetId);
	if (toIdx < 0) return [...current];
	return [...without.slice(0, toIdx), draggedId, ...without.slice(toIdx)];
}

export function wireListDnd(opts: WireListDndOptions): void {
	const { list, idAttr, classPrefix, onReorder } = opts;
	const dataSelector = `[data-${kebab(idAttr)}]`;
	const draggingClass = `${classPrefix}--dragging`;
	const dropAboveClass = `${classPrefix}--drop-above`;
	const dropBelowClass = `${classPrefix}--drop-below`;
	const dropEndClass = `${classPrefix}-list--drop-end`;

	let draggedId: string | null = null;

	const readId = (el: HTMLElement): string | null => {
		const v = el.dataset[idAttr];
		return typeof v === "string" && v.length > 0 ? v : null;
	};

	const orderedRowIds = (): string[] =>
		Array.from(list.querySelectorAll<HTMLElement>(dataSelector))
			.map(readId)
			.filter((id): id is string => id !== null);

	const clearMarkers = (): void => {
		list.classList.remove(dropEndClass);
		for (const el of list.querySelectorAll<HTMLElement>(`.${dropAboveClass}, .${dropBelowClass}`)) {
			el.classList.remove(dropAboveClass, dropBelowClass);
		}
	};

	const cleanup = (): void => {
		clearMarkers();
		for (const el of list.querySelectorAll<HTMLElement>(`.${draggingClass}`)) {
			el.classList.remove(draggingClass);
			el.setAttribute("aria-grabbed", "false");
		}
	};

	list.addEventListener("dragstart", (event) => {
		const row = (event.target as HTMLElement | null)?.closest<HTMLElement>(dataSelector);
		if (!row || !list.contains(row)) return;
		const id = readId(row);
		if (!id) return;
		draggedId = id;
		row.classList.add(draggingClass);
		row.setAttribute("aria-grabbed", "true");
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = "move";
			event.dataTransfer.setData("text/plain", id);
		}
	});

	list.addEventListener("dragover", (event) => {
		if (!draggedId) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
		const overRow = (event.target as HTMLElement | null)?.closest<HTMLElement>(dataSelector);
		clearMarkers();
		if (!overRow || !list.contains(overRow)) {
			list.classList.add(dropEndClass);
			return;
		}
		if (readId(overRow) === draggedId) return;
		const rect = overRow.getBoundingClientRect();
		const above = event.clientY < rect.top + rect.height / 2;
		overRow.classList.add(above ? dropAboveClass : dropBelowClass);
	});

	list.addEventListener("dragleave", (event) => {
		if (event.target === list) clearMarkers();
	});

	list.addEventListener("drop", (event) => {
		if (!draggedId) return;
		event.preventDefault();
		const overRow = (event.target as HTMLElement | null)?.closest<HTMLElement>(dataSelector);
		const ordered = orderedRowIds();

		let targetId: string | null = null;
		if (overRow && list.contains(overRow)) {
			const targetRowId = readId(overRow);
			if (targetRowId && targetRowId !== draggedId) {
				const rect = overRow.getBoundingClientRect();
				const above = event.clientY < rect.top + rect.height / 2;
				const idx = ordered.indexOf(targetRowId);
				targetId = above ? targetRowId : (ordered[idx + 1] ?? null);
			}
		}

		const next = applyReorder(ordered, draggedId, targetId);
		cleanup();
		draggedId = null;
		// Only fire when the ordering actually changed — avoids a wasted
		// persistence round-trip on a no-op drag.
		if (!arraysEqual(next, ordered)) onReorder(next);
	});

	list.addEventListener("dragend", () => {
		cleanup();
		draggedId = null;
	});
}

function kebab(camel: string): string {
	return camel.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}
