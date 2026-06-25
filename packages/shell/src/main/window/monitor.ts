/**
 * Multi-monitor helpers per docs/shell/12-shell-architecture.md §Multi-monitor:
 *
 *   Each window remembers which monitor it was on by `monitor_id` (a stable
 *   hash of the monitor's geometry/identifier). On launch, if that monitor
 *   is gone, the window falls back to the primary monitor at a clamped
 *   position.
 *
 * `monitor_id` is intentionally a short stable string derived from
 * (workArea x/y/width/height + scaleFactor) — Electron exposes these
 * fields on `Display`, and the combination is stable across reboots when the
 * monitor configuration is unchanged. It survives moves between USB ports,
 * resolution changes within the same physical monitor (one of {x,y,w,h}
 * shifts → new id, which is correct: the window probably belongs at a new
 * position too), and OS-level monitor rearrangement.
 *
 * Pure functions only. Electron's `screen` module is touched at the
 * window-manager layer, not here, so this is fully unit-testable.
 */

/** Subset of Electron's `Display` shape this module needs. */
export type MonitorInfo = {
	id: number;
	bounds: { x: number; y: number; width: number; height: number };
	workArea: { x: number; y: number; width: number; height: number };
	scaleFactor: number;
	primary?: boolean;
};

export type WindowPlacement = {
	x: number;
	y: number;
	width: number;
	height: number;
	maximized?: boolean;
};

const PROTOCOL_PREFIX = "mon_v1:";

/** Compute a deterministic id for a monitor. Survives any move/rename that
 *  preserves the geometry+scale; changes when the geometry changes (which is
 *  the right time to forget where the window was). */
export function monitorIdFor(monitor: MonitorInfo): string {
	const parts = [
		monitor.workArea.x,
		monitor.workArea.y,
		monitor.workArea.width,
		monitor.workArea.height,
		Math.round(monitor.scaleFactor * 100),
	];
	const sum = parts.reduce((acc, v) => Math.imul(31, acc) + v, 0) | 0;
	const hex = (sum >>> 0).toString(16).padStart(8, "0");
	return `${PROTOCOL_PREFIX}${hex}`;
}

/** Find a monitor by id; null if it isn't connected anymore. */
export function findMonitor(monitors: readonly MonitorInfo[], id: string): MonitorInfo | null {
	for (const monitor of monitors) {
		if (monitorIdFor(monitor) === id) return monitor;
	}
	return null;
}

/** Pick the primary monitor; falls back to the first one if none is flagged. */
export function pickPrimary(monitors: readonly MonitorInfo[]): MonitorInfo {
	const explicit = monitors.find((m) => m.primary);
	if (explicit) return explicit;
	const first = monitors[0];
	if (!first) {
		throw new Error("pickPrimary: no monitors connected");
	}
	return first;
}

/** Clamp a placement to fit inside a monitor's work area, preserving
 *  width/height where possible and re-centring the window if it's wider /
 *  taller than the target. */
export function clampToMonitor(
	placement: WindowPlacement,
	monitor: MonitorInfo,
	options: { minWidth?: number; minHeight?: number } = {},
): WindowPlacement {
	const minW = options.minWidth ?? 320;
	const minH = options.minHeight ?? 240;
	const area = monitor.workArea;

	const width = Math.max(minW, Math.min(placement.width, area.width));
	const height = Math.max(minH, Math.min(placement.height, area.height));

	let x = Math.max(area.x, Math.min(placement.x, area.x + area.width - width));
	let y = Math.max(area.y, Math.min(placement.y, area.y + area.height - height));

	// Recentre when the placement was clearly off-screen (e.g. window remembered
	// at -10000 because the monitor was unplugged).
	if (placement.x + placement.width <= area.x || placement.x >= area.x + area.width) {
		x = area.x + Math.max(0, Math.floor((area.width - width) / 2));
	}
	if (placement.y + placement.height <= area.y || placement.y >= area.y + area.height) {
		y = area.y + Math.max(0, Math.floor((area.height - height) / 2));
	}

	return {
		x,
		y,
		width,
		height,
		...(placement.maximized !== undefined ? { maximized: placement.maximized } : {}),
	};
}

/**
 * Resolve where to place a window given a remembered (placement, monitorId)
 * pair and the current monitor topology. If the original monitor is gone,
 * the window falls back to the primary at a clamped position.
 */
export function resolvePlacement(
	remembered: { placement: WindowPlacement; monitorId: string },
	monitors: readonly MonitorInfo[],
	options?: { minWidth?: number; minHeight?: number },
): { placement: WindowPlacement; monitor: MonitorInfo; fellBackToPrimary: boolean } {
	const original = findMonitor(monitors, remembered.monitorId);
	if (original) {
		return {
			placement: clampToMonitor(remembered.placement, original, options),
			monitor: original,
			fellBackToPrimary: false,
		};
	}
	const primary = pickPrimary(monitors);
	return {
		placement: clampToMonitor(remembered.placement, primary, options),
		monitor: primary,
		fellBackToPrimary: true,
	};
}
