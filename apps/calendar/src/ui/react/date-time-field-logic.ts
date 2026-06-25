/**
 * Pure time-slot helpers for the DateTimeField quarter-hour SelectMenu.
 * Split out so the boundary behaviour (late-evening clamp, off-grid
 * round-trip) is unit-testable without a DOM.
 */

export const TIME_SLOT_MINUTES = 15;
export const SLOTS_PER_DAY = (24 * 60) / TIME_SLOT_MINUTES;
const LAST_SLOT_MINUTES = (SLOTS_PER_DAY - 1) * TIME_SLOT_MINUTES;

function pad2(n: number): string {
	return String(n).padStart(2, "0");
}

/** Minutes-from-midnight of the closest quarter-hour slot, clamped to the
 *  day so a late-evening time never rounds past midnight (23:53 → 23:45,
 *  not 24:00). Returns a value in `[0, LAST_SLOT_MINUTES]`. */
export function nearestSlotMinutes(hour: number, minute: number): number {
	const total = hour * 60 + minute;
	const snapped = Math.round(total / TIME_SLOT_MINUTES) * TIME_SLOT_MINUTES;
	return Math.min(Math.max(snapped, 0), LAST_SLOT_MINUTES);
}

/** `HH:MM` for a minutes-from-midnight value. */
export function minutesToHhmm(minutes: number): string {
	return `${pad2(Math.floor(minutes / 60) % 24)}:${pad2(minutes % 60)}`;
}

/** Whether `hour:minute` sits exactly on a quarter-hour grid slot. */
export function isOnGrid(hour: number, minute: number): boolean {
	return minute % TIME_SLOT_MINUTES === 0;
}
