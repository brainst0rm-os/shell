/**
 * Decides what `app.on("activate")` (macOS dock click / re-open) should do
 * with the dashboard window.
 *
 * The trap this encodes: on macOS the launcher PARKS a closed app window
 * (hidden but still a live `BrowserWindow`) instead of destroying it. So
 * `BrowserWindow.getAllWindows().length` stays non-zero after the user closes
 * the dashboard while any app is parked — gating dashboard re-open on that
 * count left the app running with only unreachable hidden windows and no way
 * back to the dashboard. The decision is keyed on the dashboard window's own
 * lifecycle instead:
 *   - no dashboard window (never created, or torn down)        → Create
 *   - a live dashboard window exists (possibly hidden/minimized) → Reveal
 */

export enum DashboardActivation {
	/** Create a fresh dashboard window. */
	Create = "create",
	/** Show + focus the existing (possibly hidden) dashboard window. */
	Reveal = "reveal",
}

/** Minimal shape of the bits of the dashboard window this decision needs. */
export interface ActivatableWindow {
	isDestroyed(): boolean;
}

export function resolveDashboardActivation(
	dashboardWindow: ActivatableWindow | null,
): DashboardActivation {
	if (dashboardWindow === null || dashboardWindow.isDestroyed()) {
		return DashboardActivation.Create;
	}
	return DashboardActivation.Reveal;
}

/**
 * What a macOS dock-icon click (`app.on("activate")`) should surface.
 *
 * "Return you to what you were last doing": the dashboard and every app window
 * stamp their last-focus from one monotonic clock, so the dock click brings
 * forward whichever was focused most recently — the app window you were in, or
 * the dashboard if that's where you left off.
 *
 * The trap this replaces: gating on `dashboardWindow.isVisible()`. On macOS a
 * shown-but-backgrounded dashboard (sitting behind an app window or another OS
 * app) still reports visible, so that gate surfaced the dashboard even when the
 * user's last action was inside an app window.
 */
export enum DockActivation {
	/** Bring the most-recently-focused app window forward. */
	FocusApp = "focus-app",
	/** Show + focus the existing (possibly hidden) dashboard window. */
	RevealDashboard = "reveal-dashboard",
	/** Create a fresh dashboard window. */
	CreateDashboard = "create-dashboard",
}

/** The most-recently-focused app window, as seen by the window index. */
export interface RecentAppWindow {
	id: string;
	lastFocusedAt: number;
}

export type DockActivationResult =
	| { action: DockActivation.FocusApp; windowId: string }
	| { action: DockActivation.RevealDashboard | DockActivation.CreateDashboard };

export function resolveDockActivation(input: {
	dashboardWindow: ActivatableWindow | null;
	dashboardLastFocusedAt: number;
	mostRecentApp: RecentAppWindow | null;
}): DockActivationResult {
	const { dashboardWindow, dashboardLastFocusedAt, mostRecentApp } = input;
	// An app window wins only when it was focused *strictly* later than the
	// dashboard — a tie (e.g. both never focused) keeps the dashboard, the
	// surface the user lands on at boot.
	if (mostRecentApp && mostRecentApp.lastFocusedAt > dashboardLastFocusedAt) {
		return { action: DockActivation.FocusApp, windowId: mostRecentApp.id };
	}
	return {
		action:
			resolveDashboardActivation(dashboardWindow) === DashboardActivation.Create
				? DockActivation.CreateDashboard
				: DockActivation.RevealDashboard,
	};
}
