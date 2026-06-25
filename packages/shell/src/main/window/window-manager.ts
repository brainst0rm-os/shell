/**
 * WindowManager — tracks every window the shell owns and persists their
 * placement so the next launch can restore them.
 *
 * Per §Window manager:
 *
 *   - Maps each `BrowserWindow` to its `(app_id, window_id)`.
 *   - Persists position, size, maximized state per
 *     `(app_id, window_id, monitor_id)` triple.
 *   - Debounces position/size writes to disk.
 *   - Implements multi-monitor fallback when a remembered monitor is gone.
 *
 * Pure orchestration — `BrowserWindow` is injected as a duck-typed
 * interface so the manager is testable without Electron. The production
 * wiring binds Electron's `BrowserWindow` instances to this interface in
 * `main/index.ts` / `apps/launcher.ts`.
 */

import { type MonitorInfo, type WindowPlacement, monitorIdFor, resolvePlacement } from "./monitor";
import { type SessionState, type SessionWindow, readSession, writeSession } from "./session-state";

/** Minimal duck-typed BrowserWindow shape the manager needs. */
export interface TrackedWindow {
	readonly id: number;
	getBounds(): { x: number; y: number; width: number; height: number };
	isMaximized(): boolean;
	setBounds(bounds: { x: number; y: number; width: number; height: number }): void;
	maximize(): void;
	on(event: "move" | "resize" | "close", listener: () => void): void;
}

/** Snapshot of what's tracked for one open window. */
export type Tracked = {
	appId: string;
	windowId: string;
	window: TrackedWindow;
};

export type RestoreHint = {
	appId: string;
	windowId: string;
	placement: WindowPlacement;
	monitor: MonitorInfo;
	/** True when the original monitor wasn't found and we fell back to primary. */
	fellBackToPrimary: boolean;
};

export type WindowManagerOptions = {
	vaultPath: string;
	/** Lookup current monitor topology. Production passes `() => screen.getAllDisplays().map(asMonitorInfo)`. */
	getMonitors: () => readonly MonitorInfo[];
	/** Debounce window before flushing session.json. Default 500 ms. */
	persistDebounceMs?: number;
	/** Minimum window size enforced on restore. */
	minWidth?: number;
	minHeight?: number;
};

const DEFAULT_DEBOUNCE_MS = 500;

export class WindowManager {
	private readonly tracked = new Map<string, Tracked>(); // key: `${appId}::${windowId}`
	private pendingSnapshots = new Map<string, SessionWindow>(); // key matches `tracked`
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private disposed = false;

	constructor(private readonly options: WindowManagerOptions) {}

	/** Track a window, attach move/resize/close listeners that debounce
	 *  session-state persistence. Returns the key used internally. */
	track(appId: string, windowId: string, window: TrackedWindow): string {
		const key = this.keyFor(appId, windowId);
		const tracked: Tracked = { appId, windowId, window };
		this.tracked.set(key, tracked);
		const persist = () => this.snapshotAndQueue(tracked);
		window.on("move", persist);
		window.on("resize", persist);
		window.on("close", () => {
			// Capture one last snapshot synchronously so a quit-during-debounce
			// doesn't lose the most recent move/resize.
			this.snapshotAndQueue(tracked);
			this.tracked.delete(key);
		});
		// Initial snapshot so a never-moved window still ends up in session.json.
		this.snapshotAndQueue(tracked);
		return key;
	}

	untrack(appId: string, windowId: string): void {
		this.tracked.delete(this.keyFor(appId, windowId));
	}

	listTracked(): Tracked[] {
		return [...this.tracked.values()];
	}

	/** Compute restore hints from the persisted session.json for the given
	 *  list of `(appId, windowId)` pairs. Used by the session-restore flow
	 *  to decide where to position re-launched windows. */
	async planRestore(
		targets: ReadonlyArray<{ appId: string; windowId: string }>,
	): Promise<RestoreHint[]> {
		const state = await readSession(this.options.vaultPath);
		const monitors = this.options.getMonitors();
		if (monitors.length === 0) return [];

		const hints: RestoreHint[] = [];
		for (const target of targets) {
			const remembered = state.windows.find(
				(w) => w.appId === target.appId && w.windowId === target.windowId,
			);
			if (!remembered) continue;
			const resolved = resolvePlacement(
				{ placement: remembered.placement, monitorId: remembered.monitorId },
				monitors,
				{
					...(this.options.minWidth !== undefined ? { minWidth: this.options.minWidth } : {}),
					...(this.options.minHeight !== undefined ? { minHeight: this.options.minHeight } : {}),
				},
			);
			hints.push({
				appId: target.appId,
				windowId: target.windowId,
				placement: resolved.placement,
				monitor: resolved.monitor,
				fellBackToPrimary: resolved.fellBackToPrimary,
			});
		}
		return hints;
	}

	/** List of `(appId, windowId)` pairs that were open at last close —
	 *  caller decides which to actually re-launch. */
	async lastSessionTargets(): Promise<Array<{ appId: string; windowId: string }>> {
		const state = await readSession(this.options.vaultPath);
		return state.windows.map((w) => ({ appId: w.appId, windowId: w.windowId }));
	}

	/** Force-flush any pending session writes — call on app `will-quit`. */
	async flushNow(reason: "manual" | "quit" = "manual"): Promise<void> {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		if (this.pendingSnapshots.size === 0 && reason === "manual") {
			return;
		}

		const state = await readSession(this.options.vaultPath);
		const merged = new Map<string, SessionWindow>();
		for (const w of state.windows) {
			merged.set(this.keyFor(w.appId, w.windowId), w);
		}
		for (const [key, w] of this.pendingSnapshots) {
			merged.set(key, w);
		}
		const next: SessionState = {
			version: 1,
			windows: [...merged.values()],
			lastClosedAt: reason === "quit" ? Date.now() : state.lastClosedAt,
		};
		await writeSession(this.options.vaultPath, next);
		this.pendingSnapshots.clear();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		this.tracked.clear();
		this.pendingSnapshots.clear();
	}

	// ── internal ───────────────────────────────────────────────────────────

	private keyFor(appId: string, windowId: string): string {
		return `${appId}::${windowId}`;
	}

	private snapshotAndQueue(tracked: Tracked): void {
		const monitors = this.options.getMonitors();
		const bounds = tracked.window.getBounds();
		const monitor = pickContaining(monitors, bounds) ?? monitors[0];
		if (!monitor) return; // no monitors? nothing to record
		const snapshot: SessionWindow = {
			appId: tracked.appId,
			windowId: tracked.windowId,
			monitorId: monitorIdFor(monitor),
			placement: {
				x: bounds.x,
				y: bounds.y,
				width: bounds.width,
				height: bounds.height,
				maximized: tracked.window.isMaximized(),
			},
			updatedAt: Date.now(),
		};
		this.pendingSnapshots.set(this.keyFor(tracked.appId, tracked.windowId), snapshot);
		this.scheduleFlush();
	}

	private scheduleFlush(): void {
		if (this.flushTimer) return;
		const delay = this.options.persistDebounceMs ?? DEFAULT_DEBOUNCE_MS;
		this.flushTimer = setTimeout(() => {
			this.flushTimer = null;
			void this.flushNow("manual");
		}, delay);
	}
}

/** Find the monitor containing the centre of `bounds`. Returns null when
 *  none does (the window's centre is offscreen) — callers fall back to the
 *  first monitor in that case. */
function pickContaining(
	monitors: readonly MonitorInfo[],
	bounds: { x: number; y: number; width: number; height: number },
): MonitorInfo | null {
	const cx = bounds.x + Math.floor(bounds.width / 2);
	const cy = bounds.y + Math.floor(bounds.height / 2);
	for (const m of monitors) {
		const a = m.workArea;
		if (cx >= a.x && cx < a.x + a.width && cy >= a.y && cy < a.y + a.height) return m;
	}
	return null;
}
