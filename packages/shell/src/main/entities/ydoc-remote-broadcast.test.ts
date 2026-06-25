/**
 * `ydoc-remote-broadcast.ts` — 9.3.2c payload-bearing cross-window
 * Y.Doc delivery. Mirrors `vault-entities-broadcast.test.ts`'s window
 * fakes; the difference is this channel carries the update bytes and is
 * filtered to `targetApps` (the read-gated, replica-holding subset the
 * entities service computed).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppWindow } from "../apps/launcher";
import { APP_YDOC_REMOTE_CHANNEL, deliverYDocUpdateToApps } from "./ydoc-remote-broadcast";

function fakeAppWindow(
	appId: string,
	opts: { destroyed?: boolean } = {},
): { win: AppWindow; send: ReturnType<typeof vi.fn>; setDestroyed: (v: boolean) => void } {
	let destroyed = opts.destroyed === true;
	const send = vi.fn();
	const win = {
		appId,
		windowId: "main",
		webContentsId: 0,
		webContents: { send, isDestroyed: () => destroyed },
	} as unknown as AppWindow;
	return {
		win,
		send,
		setDestroyed: (v: boolean) => {
			destroyed = v;
		},
	};
}

describe("deliverYDocUpdateToApps", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("delivers the delta payload only to windows in targetApps", () => {
		const target = fakeAppWindow("io.brainstorm.notes");
		const other = fakeAppWindow("io.brainstorm.graph");
		deliverYDocUpdateToApps([target.win, other.win], "ent_1", "QkI=", ["io.brainstorm.notes"]);
		expect(target.send).toHaveBeenCalledWith(APP_YDOC_REMOTE_CHANNEL, {
			entityId: "ent_1",
			updateB64: "QkI=",
		});
		expect(other.send).not.toHaveBeenCalled();
	});

	it("skips destroyed windows even if targeted", () => {
		const dead = fakeAppWindow("io.brainstorm.notes", { destroyed: true });
		const live = fakeAppWindow("io.brainstorm.preview");
		deliverYDocUpdateToApps([dead.win, live.win], "ent_1", "QkI=", [
			"io.brainstorm.notes",
			"io.brainstorm.preview",
		]);
		expect(dead.send).not.toHaveBeenCalled();
		expect(live.send).toHaveBeenCalledWith(APP_YDOC_REMOTE_CHANNEL, {
			entityId: "ent_1",
			updateB64: "QkI=",
		});
	});

	it("is a no-op when targetApps is empty (fail-closed)", () => {
		const w = fakeAppWindow("io.brainstorm.notes");
		deliverYDocUpdateToApps([w.win], "ent_1", "QkI=", []);
		expect(w.send).not.toHaveBeenCalled();
	});

	it("survives an individual webContents.send throwing", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const failing = fakeAppWindow("io.brainstorm.notes");
		failing.send.mockImplementation(() => {
			throw new Error("destroyed mid-send");
		});
		const live = fakeAppWindow("io.brainstorm.preview");
		expect(() =>
			deliverYDocUpdateToApps([failing.win, live.win], "ent_1", "QkI=", [
				"io.brainstorm.notes",
				"io.brainstorm.preview",
			]),
		).not.toThrow();
		expect(live.send).toHaveBeenCalled();
		expect(warn).toHaveBeenCalled();
	});

	it("is a no-op on an empty window list", () => {
		expect(() => deliverYDocUpdateToApps([], "ent_1", "QkI=", ["io.brainstorm.notes"])).not.toThrow();
	});

	// 9.3.2d — the return value is the no-live-window subset the entities
	// service prunes from `docSubscribers` (renderer died sans closeDoc).
	it("returns [] when every targeted app has a live window", () => {
		const a = fakeAppWindow("io.brainstorm.notes");
		const b = fakeAppWindow("io.brainstorm.preview");
		const dead = deliverYDocUpdateToApps([a.win, b.win], "ent_1", "QkI=", [
			"io.brainstorm.notes",
			"io.brainstorm.preview",
		]);
		expect(dead).toEqual([]);
	});

	it("returns a targeted app that has no window at all", () => {
		const present = fakeAppWindow("io.brainstorm.notes");
		const dead = deliverYDocUpdateToApps([present.win], "ent_1", "QkI=", [
			"io.brainstorm.notes",
			"io.brainstorm.gone",
		]);
		expect(dead).toEqual(["io.brainstorm.gone"]);
	});

	it("returns a targeted app whose only window is destroyed", () => {
		const dead = fakeAppWindow("io.brainstorm.notes", { destroyed: true });
		const live = fakeAppWindow("io.brainstorm.preview");
		const result = deliverYDocUpdateToApps([dead.win, live.win], "ent_1", "QkI=", [
			"io.brainstorm.notes",
			"io.brainstorm.preview",
		]);
		expect(result).toEqual(["io.brainstorm.notes"]);
	});

	it("treats an app with one live + one destroyed window as live (not pruned)", () => {
		const dead = fakeAppWindow("io.brainstorm.notes", { destroyed: true });
		const alive = fakeAppWindow("io.brainstorm.notes");
		const result = deliverYDocUpdateToApps([dead.win, alive.win], "ent_1", "QkI=", [
			"io.brainstorm.notes",
		]);
		expect(result).toEqual([]);
		expect(alive.send).toHaveBeenCalled();
	});

	it("returns [] for an empty targetApps even with windows present", () => {
		const w = fakeAppWindow("io.brainstorm.notes");
		expect(deliverYDocUpdateToApps([w.win], "ent_1", "QkI=", [])).toEqual([]);
	});
});
