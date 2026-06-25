import { describe, expect, it } from "vitest";
import {
	DashboardActivation,
	DockActivation,
	resolveDashboardActivation,
	resolveDockActivation,
} from "./dashboard-activation";

describe("resolveDashboardActivation", () => {
	it("creates a dashboard when none exists", () => {
		expect(resolveDashboardActivation(null)).toBe(DashboardActivation.Create);
	});

	it("creates a dashboard when the previous one was destroyed", () => {
		expect(resolveDashboardActivation({ isDestroyed: () => true })).toBe(DashboardActivation.Create);
	});

	it("reveals an existing live dashboard instead of creating a duplicate", () => {
		expect(resolveDashboardActivation({ isDestroyed: () => false })).toBe(DashboardActivation.Reveal);
	});

	// Regression: closing the dashboard while an app window is parked (hidden but
	// alive) used to leave the app with no reachable window — `activate` gated on
	// `getAllWindows().length`, which the parked window kept non-zero, so the dock
	// click never reopened the dashboard. The decision now ignores other windows
	// entirely; it only sees the (now-null) dashboard reference and re-creates.
	it("re-creates the dashboard regardless of lingering parked app windows", () => {
		expect(resolveDashboardActivation(null)).toBe(DashboardActivation.Create);
	});
});

describe("resolveDockActivation", () => {
	const liveDashboard = { isDestroyed: () => false };

	// The bug this fixes: open an app (app window focused last), switch to
	// another OS app, click the Brainstorm dock icon. The dashboard is still
	// shown-but-backgrounded — the old `isVisible()` gate surfaced it instead
	// of the app window. Recency on the shared clock now wins.
	it("surfaces the most-recent app window when it was focused after the dashboard", () => {
		expect(
			resolveDockActivation({
				dashboardWindow: liveDashboard,
				dashboardLastFocusedAt: 3,
				mostRecentApp: { id: "win-1", lastFocusedAt: 7 },
			}),
		).toEqual({ action: DockActivation.FocusApp, windowId: "win-1" });
	});

	it("reveals the dashboard when it was the most-recently-focused surface", () => {
		expect(
			resolveDockActivation({
				dashboardWindow: liveDashboard,
				dashboardLastFocusedAt: 9,
				mostRecentApp: { id: "win-1", lastFocusedAt: 4 },
			}),
		).toEqual({ action: DockActivation.RevealDashboard });
	});

	it("keeps the dashboard on a tie (e.g. neither focused yet at boot)", () => {
		expect(
			resolveDockActivation({
				dashboardWindow: liveDashboard,
				dashboardLastFocusedAt: 0,
				mostRecentApp: { id: "win-1", lastFocusedAt: 0 },
			}),
		).toEqual({ action: DockActivation.RevealDashboard });
	});

	it("reveals the dashboard when no app windows are open", () => {
		expect(
			resolveDockActivation({
				dashboardWindow: liveDashboard,
				dashboardLastFocusedAt: 2,
				mostRecentApp: null,
			}),
		).toEqual({ action: DockActivation.RevealDashboard });
	});

	it("creates a dashboard when none is live, even with a more-recent app window", () => {
		// The dashboard was closed; the most-recent app window still wins focus,
		// but if that focus call fails the caller falls back to this Create.
		expect(
			resolveDockActivation({
				dashboardWindow: null,
				dashboardLastFocusedAt: 5,
				mostRecentApp: null,
			}),
		).toEqual({ action: DockActivation.CreateDashboard });
	});

	it("focuses the app window over creating a dashboard when the app is more recent", () => {
		expect(
			resolveDockActivation({
				dashboardWindow: null,
				dashboardLastFocusedAt: 0,
				mostRecentApp: { id: "win-9", lastFocusedAt: 1 },
			}),
		).toEqual({ action: DockActivation.FocusApp, windowId: "win-9" });
	});
});
