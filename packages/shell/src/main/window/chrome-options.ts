/**
 * Per-OS window chrome shared by the dashboard and every app window:
 *
 *   macOS    → `titleBarStyle: "hidden"` removes the native title bar
 *              entirely; we still draw traffic lights via
 *              `trafficLightPosition`. `"hiddenInset"` would render a 1-px
 *              system separator under the title bar that's visible against
 *              our dark chrome — `"hidden"` skips it.
 *   others   → `titleBarStyle: "hidden"` with `titleBarOverlay` so Win/Linux
 *              gets a 36-px custom drag strip with platform buttons.
 *
 * Owning this in one module means the dashboard and app windows always
 * agree about window chrome — important for the "every Brainstorm window
 * looks like the dashboard" identity we're building toward in Phase 6.
 */

const isMac = process.platform === "darwin";

export function brainstormChromeOptions() {
	if (isMac) {
		return {
			titleBarStyle: "hidden" as const,
			trafficLightPosition: { x: 14, y: 14 },
		};
	}
	return {
		titleBarStyle: "hidden" as const,
		titleBarOverlay: {
			color: "#0b1220",
			symbolColor: "#e7eef9",
			height: 36,
		},
	};
}
