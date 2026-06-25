/**
 * Foreground app-activity tracker for auto-lock (Stage 13.8 surface).
 *
 * The auto-lock watcher's only signal used to be `powerMonitor.getSystemIdleTime()`
 * — OS keyboard/mouse idle. That trips the lock during genuine in-app activity
 * that emits no HID input (watching a video, a long import/sync, a render),
 * because the OS idle counter keeps climbing while the user is plainly here.
 *
 * This records the last *foreground* app→host IPC as activity. The watcher folds
 * it into the idle decision (`min(systemIdle, appIdle)`), so interacting with the
 * front app defers the lock even with no keyboard/mouse input. Only IPC from a
 * focused window is noted (the call site gates on focus) — a background or
 * unfocused renderer polling the broker must not be able to defeat the lock.
 *
 * Pure of `electron`: the clock is injectable for tests; production passes
 * `Date.now()`.
 */

let lastActivityAtMs = 0;

/** Record a foreground app interaction (called per focused `broker:dispatch`). */
export function noteAppActivity(nowMs: number = Date.now()): void {
	lastActivityAtMs = nowMs;
}

/**
 * Seconds since the last foreground app activity. `Infinity` before any activity
 * has been recorded, so the watcher falls back to the system-idle baseline and
 * behaves exactly as it did before this signal existed.
 */
export function appActivityIdleSeconds(nowMs: number = Date.now()): number {
	if (lastActivityAtMs === 0) return Number.POSITIVE_INFINITY;
	return Math.max(0, (nowMs - lastActivityAtMs) / 1000);
}

/** Test seam — reset the module-level timestamp between cases. */
export function resetAppActivityForTest(): void {
	lastActivityAtMs = 0;
}
