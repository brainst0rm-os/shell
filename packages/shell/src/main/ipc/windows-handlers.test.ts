/**
 * `windows-handlers.ts` broadcast tests — exercise the
 * `windows:changed` dashboard-only signal that re-renders the running-apps
 * tile strip whenever the WindowIndex reconciles.
 *
 * Same threat model as `broadcastStaleSignalToAppWindows`: a renderer
 * can be in a transient `WebFrameMain`-disposed state while
 * `BrowserWindow.isDestroyed()` still returns false, so the inner
 * `webContents.send` is guarded by try/catch. Regression-fence: an
 * individual throw from `send` MUST be swallowed (it gets logged), not
 * propagate out and crash the WindowIndex listener chain.
 */

import type { BrowserWindow } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WINDOWS_CHANGED_CHANNEL, broadcastWindowsChangedToDashboard } from "./windows-handlers";

type FakeDashboard = {
	send: ReturnType<typeof vi.fn>;
	destroyed: boolean;
};

function fakeDashboard(opts: { destroyed?: boolean } = {}): {
	bw: BrowserWindow;
	rec: FakeDashboard;
} {
	const rec: FakeDashboard = {
		send: vi.fn(),
		destroyed: opts.destroyed === true,
	};
	const bw = {
		isDestroyed: () => rec.destroyed,
		webContents: { send: rec.send },
	} as unknown as BrowserWindow;
	return { bw, rec };
}

describe("broadcastWindowsChangedToDashboard", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("sends the snapshot to the dashboard webContents", () => {
		const { bw, rec } = fakeDashboard();
		broadcastWindowsChangedToDashboard(bw, []);
		expect(rec.send).toHaveBeenCalledWith(WINDOWS_CHANGED_CHANNEL, []);
	});

	it("forwards the entries array verbatim", () => {
		const { bw, rec } = fakeDashboard();
		const entries = [{ id: "x", appId: "io.brainstorm.notes" } as never];
		broadcastWindowsChangedToDashboard(bw, entries);
		expect(rec.send).toHaveBeenCalledWith(WINDOWS_CHANGED_CHANNEL, entries);
	});

	it("is a no-op when the dashboard is null", () => {
		expect(() => broadcastWindowsChangedToDashboard(null, [])).not.toThrow();
	});

	it("is a no-op when the dashboard is destroyed", () => {
		const { bw, rec } = fakeDashboard({ destroyed: true });
		broadcastWindowsChangedToDashboard(bw, []);
		expect(rec.send).not.toHaveBeenCalled();
	});

	// Regression-fence for the error-log triage finding: `BrowserWindow.isDestroyed()`
	// returns false during a transient `WebFrameMain` disposal (reload /
	// navigation race), `webContents.send` then throws "Render frame was
	// disposed before WebFrameMain could be accessed". The broadcaster MUST
	// log + swallow, never propagate out of the WindowIndex listener.
	it("swallows a 'Render frame was disposed' throw from webContents.send", () => {
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const { bw, rec } = fakeDashboard();
		rec.send.mockImplementation(() => {
			throw new Error("Render frame was disposed before WebFrameMain could be accessed");
		});
		expect(() => broadcastWindowsChangedToDashboard(bw, [])).not.toThrow();
		expect(consoleSpy).toHaveBeenCalled();
	});
});
