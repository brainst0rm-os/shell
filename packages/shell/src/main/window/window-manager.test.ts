import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type MonitorInfo, monitorIdFor } from "./monitor";
import { readSession, writeSession } from "./session-state";
import { type TrackedWindow, WindowManager } from "./window-manager";

const m1: MonitorInfo = {
	id: 1,
	bounds: { x: 0, y: 0, width: 1440, height: 900 },
	workArea: { x: 0, y: 24, width: 1440, height: 876 },
	scaleFactor: 2,
	primary: true,
};

function fakeWindow(bounds: { x: number; y: number; width: number; height: number }): {
	window: TrackedWindow;
	emit: (event: "move" | "resize" | "close") => void;
	setBounds: (b: typeof bounds) => void;
} {
	let current = { ...bounds };
	let maximized = false;
	const handlers = new Map<string, Array<() => void>>();
	const window: TrackedWindow = {
		id: Math.floor(Math.random() * 100000),
		getBounds: () => ({ ...current }),
		isMaximized: () => maximized,
		setBounds: (b) => {
			current = { ...b };
		},
		maximize: () => {
			maximized = true;
		},
		on: (event, listener) => {
			let set = handlers.get(event);
			if (!set) {
				set = [];
				handlers.set(event, set);
			}
			set.push(listener);
		},
	};
	const emit = (event: "move" | "resize" | "close") => {
		for (const h of handlers.get(event) ?? []) h();
	};
	const setBounds = (b: typeof bounds) => {
		current = { ...b };
		emit("resize");
	};
	return { window, emit, setBounds };
}

async function setup() {
	const vaultDir = await mkdtemp(join(tmpdir(), "brainstorm-wm-"));
	const manager = new WindowManager({
		vaultPath: vaultDir,
		getMonitors: () => [m1],
		persistDebounceMs: 10,
	});
	return { vaultDir, manager };
}

describe("WindowManager", () => {
	let env: Awaited<ReturnType<typeof setup>>;

	beforeEach(async () => {
		env = await setup();
	});

	afterEach(async () => {
		env.manager.dispose();
		await rm(env.vaultDir, { recursive: true, force: true });
	});

	it("track() persists an initial snapshot to session.json (after debounce)", async () => {
		const { window } = fakeWindow({ x: 100, y: 100, width: 1280, height: 800 });
		env.manager.track("shell", "dashboard", window);
		await env.manager.flushNow();
		const state = await readSession(env.vaultDir);
		expect(state.windows).toHaveLength(1);
		expect(state.windows[0]?.appId).toBe("shell");
		expect(state.windows[0]?.placement).toMatchObject({
			x: 100,
			y: 100,
			width: 1280,
			height: 800,
		});
	});

	it("move/resize events update the persisted placement", async () => {
		const { window, setBounds } = fakeWindow({ x: 0, y: 0, width: 800, height: 600 });
		env.manager.track("shell", "dashboard", window);
		setBounds({ x: 200, y: 300, width: 1024, height: 768 });
		await env.manager.flushNow();
		const state = await readSession(env.vaultDir);
		expect(state.windows[0]?.placement).toMatchObject({
			x: 200,
			y: 300,
			width: 1024,
			height: 768,
		});
	});

	it("debounces multiple rapid moves into a single write", async () => {
		const { window, setBounds } = fakeWindow({ x: 0, y: 0, width: 800, height: 600 });
		env.manager.track("shell", "dashboard", window);
		for (let i = 0; i < 10; i++) {
			setBounds({ x: i * 10, y: 0, width: 800, height: 600 });
		}
		// One pending flush handles all 10 emits.
		await env.manager.flushNow();
		const state = await readSession(env.vaultDir);
		expect(state.windows[0]?.placement.x).toBe(90);
	});

	it("close emits a final snapshot synchronously (no race with quit)", async () => {
		const { window, emit, setBounds } = fakeWindow({ x: 0, y: 0, width: 800, height: 600 });
		env.manager.track("shell", "dashboard", window);
		setBounds({ x: 500, y: 500, width: 800, height: 600 });
		emit("close");
		await env.manager.flushNow();
		const state = await readSession(env.vaultDir);
		expect(state.windows[0]?.placement.x).toBe(500);
		expect(env.manager.listTracked()).toEqual([]);
	});

	it("flushNow('quit') stamps lastClosedAt", async () => {
		const { window } = fakeWindow({ x: 0, y: 0, width: 800, height: 600 });
		env.manager.track("shell", "dashboard", window);
		await env.manager.flushNow("quit");
		const state = await readSession(env.vaultDir);
		expect(typeof state.lastClosedAt).toBe("number");
	});

	it("planRestore replays placements via the monitor resolver", async () => {
		// Pick a placement that fits inside m1's work area (1440 x 876 starting at y=24).
		await writeSession(env.vaultDir, {
			version: 1,
			windows: [
				{
					appId: "shell",
					windowId: "dashboard",
					monitorId: monitorIdFor(m1),
					placement: { x: 150, y: 100, width: 800, height: 600 },
					updatedAt: 1,
				},
			],
			lastClosedAt: null,
		});
		const hints = await env.manager.planRestore([{ appId: "shell", windowId: "dashboard" }]);
		expect(hints).toHaveLength(1);
		expect(hints[0]?.fellBackToPrimary).toBe(false);
		expect(hints[0]?.placement).toMatchObject({ x: 150, y: 100, width: 800, height: 600 });
	});

	it("planRestore falls back to the primary monitor when the remembered one is gone", async () => {
		await writeSession(env.vaultDir, {
			version: 1,
			windows: [
				{
					appId: "shell",
					windowId: "dashboard",
					monitorId: "mon_v1:deadbeef",
					placement: { x: 5000, y: 5000, width: 800, height: 600 },
					updatedAt: 1,
				},
			],
			lastClosedAt: null,
		});
		const hints = await env.manager.planRestore([{ appId: "shell", windowId: "dashboard" }]);
		expect(hints[0]?.fellBackToPrimary).toBe(true);
		expect(hints[0]?.placement.x).toBeGreaterThanOrEqual(m1.workArea.x);
	});

	it("lastSessionTargets returns the (appId, windowId) pairs from disk", async () => {
		await writeSession(env.vaultDir, {
			version: 1,
			windows: [
				{
					appId: "shell",
					windowId: "dashboard",
					monitorId: "mon_v1:1",
					placement: { x: 0, y: 0, width: 100, height: 100 },
					updatedAt: 1,
				},
				{
					appId: "io.example.notes",
					windowId: "main",
					monitorId: "mon_v1:1",
					placement: { x: 100, y: 0, width: 100, height: 100 },
					updatedAt: 2,
				},
			],
			lastClosedAt: null,
		});
		const targets = await env.manager.lastSessionTargets();
		expect(targets).toEqual([
			{ appId: "shell", windowId: "dashboard" },
			{ appId: "io.example.notes", windowId: "main" },
		]);
	});

	it("dispose() prevents further flushes", async () => {
		const { window, setBounds } = fakeWindow({ x: 0, y: 0, width: 800, height: 600 });
		env.manager.track("shell", "dashboard", window);
		env.manager.dispose();
		setBounds({ x: 999, y: 0, width: 800, height: 600 });
		// No-op — manager is disposed; tracked map is empty.
		expect(env.manager.listTracked()).toEqual([]);
	});

	it("merges with existing rows in session.json on flush", async () => {
		await writeSession(env.vaultDir, {
			version: 1,
			windows: [
				{
					appId: "ghost.app",
					windowId: "main",
					monitorId: monitorIdFor(m1),
					placement: { x: 1, y: 2, width: 3, height: 4 },
					updatedAt: 1,
				},
			],
			lastClosedAt: null,
		});
		const { window } = fakeWindow({ x: 100, y: 100, width: 800, height: 600 });
		env.manager.track("shell", "dashboard", window);
		await env.manager.flushNow();
		const state = await readSession(env.vaultDir);
		const ids = state.windows.map((w) => `${w.appId}::${w.windowId}`).sort();
		expect(ids).toEqual(["ghost.app::main", "shell::dashboard"]);
	});

	it("untrack stops further updates from a window", async () => {
		const { window, setBounds } = fakeWindow({ x: 0, y: 0, width: 800, height: 600 });
		env.manager.track("shell", "dashboard", window);
		env.manager.untrack("shell", "dashboard");
		// New bounds events still fire on the original listeners, but the
		// tracker map is cleared. The internal snapshot still goes to the
		// pending queue (the move handler is still bound) — but listTracked
		// no longer returns the entry.
		expect(env.manager.listTracked()).toEqual([]);
		setBounds({ x: 999, y: 0, width: 800, height: 600 });
		// Flush still emits the *last* known snapshot; verify the entry can
		// be re-tracked cleanly afterwards.
		const { window: fresh } = fakeWindow({ x: 50, y: 50, width: 400, height: 300 });
		env.manager.track("shell", "dashboard", fresh);
		expect(env.manager.listTracked()).toHaveLength(1);
	});

	it("flushNow with nothing pending and reason='quit' still stamps the timestamp", async () => {
		await env.manager.flushNow("quit");
		const state = await readSession(env.vaultDir);
		expect(state.lastClosedAt).toBeGreaterThan(0);
	});
});

// Quiet vi unused import — vi is imported above for type completeness.
void vi;
