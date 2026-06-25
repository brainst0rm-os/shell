/**
 * `properties-handlers.ts` broadcast tests — exercise the
 * `app:properties-changed` stale-signal that lets sandboxed app
 * renderers (Notes, Database, Graph) refresh their property catalog
 * when an external surface (Settings → Data, sibling apps, future
 * sync peers) writes to the shell's `PropertiesStore`.
 *
 * The CRUD methods proxy directly into `PropertiesStore`, which has
 * its own coverage under `properties/properties-store.test.ts`. Here
 * we only cover the broadcast helper.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppWindow } from "../apps/launcher";
import {
	APP_PROPERTIES_CHANGED_CHANNEL,
	broadcastStaleSignalToAppWindows,
} from "./properties-handlers";

type FakeWindow = {
	appId: string;
	send: ReturnType<typeof vi.fn>;
	destroyed: boolean;
};

function fakeAppWindow(
	appId: string,
	opts: { destroyed?: boolean } = {},
): {
	win: AppWindow;
	rec: FakeWindow;
} {
	const rec: FakeWindow = {
		appId,
		send: vi.fn(),
		destroyed: opts.destroyed === true,
	};
	const win = {
		appId,
		windowId: "main",
		webContentsId: 0,
		webContents: { send: rec.send, isDestroyed: () => rec.destroyed },
	} as unknown as AppWindow;
	return { win, rec };
}

describe("broadcastStaleSignalToAppWindows", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("sends `app:properties-changed` to every live app window", () => {
		const a = fakeAppWindow("io.brainstorm.notes");
		const b = fakeAppWindow("io.brainstorm.database");
		broadcastStaleSignalToAppWindows([a.win, b.win]);
		expect(a.rec.send).toHaveBeenCalledWith(APP_PROPERTIES_CHANGED_CHANNEL);
		expect(b.rec.send).toHaveBeenCalledWith(APP_PROPERTIES_CHANGED_CHANNEL);
	});

	it("skips destroyed windows", () => {
		const live = fakeAppWindow("io.brainstorm.notes");
		const dead = fakeAppWindow("io.brainstorm.database", { destroyed: true });
		broadcastStaleSignalToAppWindows([dead.win, live.win]);
		expect(dead.rec.send).not.toHaveBeenCalled();
		expect(live.rec.send).toHaveBeenCalledWith(APP_PROPERTIES_CHANGED_CHANNEL);
	});

	it("survives an individual webContents.send throwing", () => {
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const failing = fakeAppWindow("io.brainstorm.notes");
		failing.rec.send.mockImplementation(() => {
			throw new Error("destroyed mid-send");
		});
		const live = fakeAppWindow("io.brainstorm.database");
		expect(() => broadcastStaleSignalToAppWindows([failing.win, live.win])).not.toThrow();
		expect(live.rec.send).toHaveBeenCalledWith(APP_PROPERTIES_CHANGED_CHANNEL);
		expect(consoleSpy).toHaveBeenCalled();
	});

	it("is a no-op on an empty array", () => {
		expect(() => broadcastStaleSignalToAppWindows([])).not.toThrow();
	});
});
