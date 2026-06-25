/**
 * Drag-to-reschedule for calendar chips (Month day-cells) and timed blocks
 * (Week / Day hour columns). Faithful port of the imperative
 * `attachChipDrag` / `attachBlockDrag`: a fixed-position ghost clone follows
 * the pointer, the original stays in place (dimmed via
 * `[data-source-dragging]`) so a rejected drop leaves the grid untouched,
 * the drop target is found via `elementsFromPoint`, and the synthesized
 * click after a real drag is suppressed.
 *
 * Returned as `onPointerDown` handlers the chip/block spreads onto its
 * button element — the element itself is React-rendered, the drag mechanics
 * are imperative on the live DOM node (the sanctioned ref-boundary pattern).
 */

import { shiftToDay, snapToMinutes } from "../../logic/reschedule";

const DRAG_THRESHOLD_PX = 4;
const HOUR_HEIGHT_PX = 64;
const TOTAL_HOURS = 24;
const SNAP_MINUTES = 15;

function makeGhost(source: HTMLElement, rect: DOMRect): HTMLElement {
	const ghost = source.cloneNode(true) as HTMLElement;
	ghost.classList.add("cal-chip--drag-ghost");
	ghost.removeAttribute("data-source-dragging");
	ghost.style.position = "fixed";
	ghost.style.left = `${rect.left}px`;
	ghost.style.top = `${rect.top}px`;
	ghost.style.width = `${rect.width}px`;
	ghost.style.height = `${rect.height}px`;
	ghost.style.pointerEvents = "none";
	ghost.style.zIndex = "1000";
	return ghost;
}

function suppressOnce(event: Event): void {
	event.stopPropagation();
	event.preventDefault();
}

function clampToDay(mins: number): number {
	if (mins < 0) return 0;
	if (mins > TOTAL_HOURS * 60) return TOTAL_HOURS * 60;
	return mins;
}

function clampPx(top: number): number {
	const max = TOTAL_HOURS * HOUR_HEIGHT_PX;
	if (top < 0) return 0;
	if (top > max) return max;
	return top;
}

/** Find the month day-cell under the pointer. */
function monthCellUnderPointer(
	x: number,
	y: number,
): { cell: HTMLElement; dayStart: number } | null {
	for (const el of document.elementsFromPoint(x, y)) {
		const cell = (el as HTMLElement).closest?.(".bs-cal-month__cell") as HTMLElement | null;
		if (cell?.dataset.dateEpochMs) {
			return { cell, dayStart: Number(cell.dataset.dateEpochMs) };
		}
	}
	return null;
}

/** Find the week day-column under the pointer. */
function weekColumnUnderPointer(
	x: number,
	y: number,
): { column: HTMLElement; dayStart: number } | null {
	for (const el of document.elementsFromPoint(x, y)) {
		const column = (el as HTMLElement).closest?.(".cal-week__column") as HTMLElement | null;
		if (column?.dataset.dayStart) {
			return { column, dayStart: Number(column.dataset.dayStart) };
		}
	}
	return null;
}

/** Begin a Month-view chip drag from its `pointerdown`. Pure DOM mechanics. */
export function beginMonthChipDrag(
	down: PointerEvent,
	chip: HTMLElement,
	start: number,
	onReschedule: (newStart: number) => void,
): void {
	if (down.button !== 0) return;
	const chipRect = chip.getBoundingClientRect();
	const offsetX = down.clientX - chipRect.left;
	const offsetY = down.clientY - chipRect.top;
	const startX = down.clientX;
	const startY = down.clientY;
	let moved = false;
	let ghost: HTMLElement | null = null;
	let targetCell: HTMLElement | null = null;
	let targetDayStart: number | null = null;

	const onMove = (move: PointerEvent): void => {
		const dx = move.clientX - startX;
		const dy = move.clientY - startY;
		if (!moved && Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
		if (!moved) {
			moved = true;
			chip.setPointerCapture(down.pointerId);
			chip.dataset.sourceDragging = "true";
			ghost = makeGhost(chip, chipRect);
			document.body.appendChild(ghost);
		}
		if (ghost) {
			ghost.style.left = `${move.clientX - offsetX}px`;
			ghost.style.top = `${move.clientY - offsetY}px`;
		}
		const hit = monthCellUnderPointer(move.clientX, move.clientY);
		if (hit?.cell !== targetCell) {
			targetCell?.removeAttribute("data-drop-target");
			targetCell = hit?.cell ?? null;
			targetDayStart = hit?.dayStart ?? null;
			targetCell?.setAttribute("data-drop-target", "true");
		}
	};

	const onUp = (): void => {
		chip.removeEventListener("pointermove", onMove);
		chip.removeEventListener("pointerup", onUp);
		chip.removeEventListener("pointercancel", onUp);
		targetCell?.removeAttribute("data-drop-target");
		ghost?.remove();
		ghost = null;
		delete chip.dataset.sourceDragging;
		if (!moved) return;
		chip.addEventListener("click", suppressOnce, { capture: true, once: true });
		if (targetDayStart === null) return;
		const newStart = shiftToDay(start, targetDayStart);
		if (newStart !== start) onReschedule(newStart);
	};

	chip.addEventListener("pointermove", onMove);
	chip.addEventListener("pointerup", onUp);
	chip.addEventListener("pointercancel", onUp);
}

/** Begin a Week/Day-view timed block drag from its `pointerdown`. */
export function beginBlockDrag(
	down: PointerEvent,
	block: HTMLElement,
	start: number,
	originDayStart: number,
	onReschedule: (newStart: number) => void,
): void {
	if (down.button !== 0) return;
	const pxPerMin = HOUR_HEIGHT_PX / 60;
	const blockRect = block.getBoundingClientRect();
	const offsetX = down.clientX - blockRect.left;
	const offsetY = down.clientY - blockRect.top;
	const originTop = Number.parseFloat(block.style.top) || 0;
	const startX = down.clientX;
	const startY = down.clientY;
	let moved = false;
	let ghost: HTMLElement | null = null;
	let targetDayStart = originDayStart;
	let targetColumn: HTMLElement | null = null;

	const onMove = (move: PointerEvent): void => {
		const dy = move.clientY - startY;
		const dx = move.clientX - startX;
		if (!moved && Math.abs(dy) < DRAG_THRESHOLD_PX && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
		if (!moved) {
			moved = true;
			block.setPointerCapture(down.pointerId);
			block.dataset.sourceDragging = "true";
			ghost = makeGhost(block, blockRect);
			document.body.appendChild(ghost);
		}
		if (ghost) {
			ghost.style.left = `${move.clientX - offsetX}px`;
			ghost.style.top = `${move.clientY - offsetY}px`;
		}
		const hit = weekColumnUnderPointer(move.clientX, move.clientY);
		if (hit?.column !== targetColumn) {
			targetColumn?.removeAttribute("data-drop-target");
			targetColumn = hit?.column ?? null;
			targetDayStart = hit?.dayStart ?? originDayStart;
			targetColumn?.setAttribute("data-drop-target", "true");
		}
	};

	const onUp = (move: PointerEvent): void => {
		block.removeEventListener("pointermove", onMove);
		block.removeEventListener("pointerup", onUp);
		block.removeEventListener("pointercancel", onUp);
		targetColumn?.removeAttribute("data-drop-target");
		ghost?.remove();
		ghost = null;
		delete block.dataset.sourceDragging;
		if (!moved) return;
		const dy = move.clientY - startY;
		const finalTop = clampPx(originTop + dy);
		const rawMins = clampToDay(finalTop / pxPerMin);
		const newStart = snapToMinutes(targetDayStart + rawMins * 60_000, SNAP_MINUTES);
		block.addEventListener("click", suppressOnce, { capture: true, once: true });
		if (newStart !== start) onReschedule(newStart);
	};

	block.addEventListener("pointermove", onMove);
	block.addEventListener("pointerup", onUp);
	block.addEventListener("pointercancel", onUp);
}
