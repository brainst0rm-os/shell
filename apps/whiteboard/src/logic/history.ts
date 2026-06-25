/**
 * Undo / redo history (9.17.17) — a pure snapshot stack.
 *
 * The whiteboard persists every gesture immediately with no history; this is
 * the model behind Cmd+Z / Cmd+Shift+Z. The app records a board snapshot after
 * each persisted mutation; undo/redo step a cursor through the stack and return
 * the snapshot to restore. Pure + generic so the stepping/capping logic is
 * proven without the board or the DOM. Snapshots are caller-cloned (the app
 * deep-clones the board before pushing) so a later in-place mutation can't
 * corrupt a stored entry.
 */

export type HistoryState<T> = {
	/** Snapshots oldest→newest; `stack[index]` is the current present. */
	stack: T[];
	index: number;
};

/** Max snapshots kept (older ones drop off the bottom). */
export const DEFAULT_HISTORY_CAP = 100;

/** Seed the history with the initial present state. */
export function initialHistory<T>(present: T): HistoryState<T> {
	return { stack: [present], index: 0 };
}

/**
 * Record a new present. Truncates any redo tail (states after the cursor),
 * pushes `next`, and caps the stack length — when capped, the oldest entry
 * drops and the index follows. A no-op when `next` is identical (`===`) to the
 * current present (the caller should pass a fresh clone, so this mainly guards
 * a double-record).
 */
export function pushHistory<T>(
	history: HistoryState<T>,
	next: T,
	cap: number = DEFAULT_HISTORY_CAP,
): HistoryState<T> {
	if (history.stack[history.index] === next) return history;
	const kept = history.stack.slice(0, history.index + 1);
	kept.push(next);
	const overflow = Math.max(0, kept.length - cap);
	const stack = overflow > 0 ? kept.slice(overflow) : kept;
	return { stack, index: stack.length - 1 };
}

export function canUndo<T>(history: HistoryState<T>): boolean {
	return history.index > 0;
}

export function canRedo<T>(history: HistoryState<T>): boolean {
	return history.index < history.stack.length - 1;
}

/** Step back one snapshot. Returns the new history + the present to restore, or
 *  `null` when there's nothing to undo. */
export function undo<T>(history: HistoryState<T>): { history: HistoryState<T>; present: T } | null {
	if (!canUndo(history)) return null;
	const index = history.index - 1;
	return { history: { stack: history.stack, index }, present: history.stack[index] as T };
}

/** Step forward one snapshot. */
export function redo<T>(history: HistoryState<T>): { history: HistoryState<T>; present: T } | null {
	if (!canRedo(history)) return null;
	const index = history.index + 1;
	return { history: { stack: history.stack, index }, present: history.stack[index] as T };
}
