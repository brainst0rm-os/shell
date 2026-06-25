/**
 * Regression: Graph keeps running (and feels like it "hangs"/sluggish) after
 * the window is closed.
 *
 * Closing an app window doesn't destroy it — the shell PARKS it (hide, keep
 * alive) so re-open is instant. The trap: on macOS `BrowserWindow.hide()`
 * does NOT flip the renderer's Page Visibility (`document.visibilityState`
 * stays "visible"), so Chromium's background throttling never engages and the
 * Graph's main-thread force-sim + Pixi render loop keep running full-speed on
 * a window the user "closed". With several parked windows sharing one GPU
 * process that is felt as the shell going sluggish right after a close.
 *
 * Fix: the main process emits `window:visibility-changed` off the window's own
 * hide/show; the app-preload forwards it as `brainstorm:app-visibility`; the
 * Graph app pauses its rAF loop while hidden and resumes on show.
 *
 * This spec opens Graph, parks it via the real close path, and asserts (a) the
 * park signal reached the renderer and (b) the render loop fully flatlines
 * (zero frames) while parked. Before the fix this window ran ~90 frames.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { launchShell } from "../lib/launch-shell";

const GRAPH_APP_ID = "io.brainstorm.graph";

type GraphProbe = {
	nodes: () => unknown[];
	frames: () => number;
};

async function ensureVaultAndSeed(dashboard: Page, userDataDir: string): Promise<void> {
	await dashboard.evaluate(
		async ({ userDataDir }) => {
			const bs = (
				window as unknown as {
					brainstorm: {
						vaults: {
							list: () => Promise<unknown[]>;
							create: (opts: { name: string; path: string }) => Promise<unknown>;
							activate: (id: string) => Promise<unknown>;
							session: () => Promise<unknown>;
						};
						dev: { seedDemoApps: () => Promise<unknown> };
					};
				}
			).brainstorm;
			const list = (await bs.vaults.list()) as Array<{ id: string }>;
			let session = await bs.vaults.session();
			if (list.length === 0) {
				await bs.vaults.create({ name: "close-hang-fixture", path: `${userDataDir}/vault` });
				session = await bs.vaults.session();
			} else if (!session && list[0]) {
				await bs.vaults.activate(list[0].id);
				session = await bs.vaults.session();
			}
			if (!session) throw new Error("close-hang harness: no active vault after setup");
			// `seedDemoApps` installs the apps (incl. Graph); the welcome seed
			// already created enough entities for a non-empty graph. The heavy
			// `reseedVault` isn't needed — the loop spins regardless of scene size.
			await bs.dev.seedDemoApps();
		},
		{ userDataDir },
	);
}

test("a parked (closed) graph window stops its render loop", async () => {
	test.setTimeout(180_000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-close-hang-"));
	try {
		const { app } = await launchShell({ userDataDir, timeoutMs: 120_000 });
		try {
			const dashboard = await app.firstWindow({ timeout: 60_000 });
			await dashboard.waitForLoadState("load", { timeout: 60_000 });
			await ensureVaultAndSeed(dashboard, userDataDir);

			const graphWindow = app.waitForEvent("window", { timeout: 30_000 });
			await dashboard.evaluate(
				(id) =>
					(
						window as unknown as { brainstorm: { apps: { launch: (id: string) => Promise<void> } } }
					).brainstorm.apps.launch(id),
				GRAPH_APP_ID,
			);
			const win = await graphWindow;
			win.on("pageerror", (e) => console.log("[graph-win:pageerror]", e.message));
			await win.waitForLoadState("domcontentloaded", { timeout: 30_000 });

			await win.waitForFunction(
				() => {
					const probe = (window as unknown as { __graphProbe?: GraphProbe }).__graphProbe;
					return !!probe && probe.nodes().length >= 1;
				},
				null,
				{ timeout: 30_000 },
			);
			// Let the auto-fit + pre-converge settle so the scene is fully built.
			await win.waitForTimeout(2000);

			// Park the graph via the real close path (windows:close → launcher parks).
			const winId = await dashboard.evaluate(async () => {
				const bs = (
					window as unknown as {
						brainstorm: { windows: { list: () => Promise<Array<{ id: string; appId?: string }>> } };
					}
				).brainstorm;
				const list = await bs.windows.list();
				return list.find((w) => w.appId === "io.brainstorm.graph")?.id ?? null;
			});
			expect(winId, "graph window should be in the window index").not.toBeNull();
			await dashboard.evaluate(
				(id) =>
					(
						window as unknown as { brainstorm: { windows: { close: (id: string) => Promise<boolean> } } }
					).brainstorm.windows.close(id as string),
				winId,
			);

			// Let the park handshake (windows.close → main hide() → visibility IPC
			// → preload event → app pause) settle; a few 60 fps frames run during
			// it and that's fine. Then assert the STEADY state is zero frames.
			await dashboard.waitForTimeout(1500);
			const sampleA = await win.evaluate(() => ({
				frames: (window as unknown as { __graphProbe: GraphProbe }).__graphProbe.frames(),
				// `appHidden` is set ONLY by the main-process visibility IPC
				// (park/hide), never by occlusion — proves the park signal landed.
				appHidden: document.documentElement.dataset.appHidden ?? "unset",
			}));
			await dashboard.waitForTimeout(1500);
			const framesB = await win.evaluate(() =>
				(window as unknown as { __graphProbe: GraphProbe }).__graphProbe.frames(),
			);
			const framesWhileSteadyParked = framesB - sampleA.frames;
			console.log(
				`[close-hang] frames while parked (steady 1.5s): ${framesWhileSteadyParked}; appHidden=${sampleA.appHidden}`,
			);

			expect(sampleA.appHidden, "park visibility IPC must reach the app").toBe("true");
			expect(
				framesWhileSteadyParked,
				"a parked graph must stop its render loop entirely",
			).toBeLessThan(3);

			// Resume path: re-launching the app un-parks it (show()) → the loop
			// must restart so the graph is live again on re-open.
			const framesAtUnpark = framesB;
			await dashboard.evaluate(
				(id) =>
					(
						window as unknown as { brainstorm: { apps: { launch: (id: string) => Promise<void> } } }
					).brainstorm.apps.launch(id),
				GRAPH_APP_ID,
			);
			await dashboard.waitForTimeout(1000);
			const resumed = await win.evaluate(() => ({
				frames: (window as unknown as { __graphProbe: GraphProbe }).__graphProbe.frames(),
				appHidden: document.documentElement.dataset.appHidden ?? "unset",
			}));
			console.log(
				`[close-hang] frames after un-park (1s): ${resumed.frames - framesAtUnpark}; appHidden=${resumed.appHidden}`,
			);
			expect(resumed.appHidden, "un-park visibility IPC must reach the app").toBe("false");
			expect(
				resumed.frames - framesAtUnpark,
				"an un-parked graph must resume its render loop",
			).toBeGreaterThan(5);

			// Occlusion cycle (Cmd-Tab away/back, or another window covering the
			// graph): fires `visibilitychange` hidden→visible with NO park IPC.
			// The loop must pause on hidden and RESUME on visible — regression
			// for the bug where occlusion-hidden stuck the loop paused (zoom/pan
			// silently dead). We assert on the app's own paused state
			// (`probe.hidden()`) rather than frame count: the real graph window
			// is occluded behind the dashboard here, so Chromium throttles its
			// rAF regardless — `hidden()` reflects our pause/resume logic
			// directly, frame count would conflate the two. Page Visibility is
			// read-only, so fake the getter.
			const occlusion = await win.evaluate(async () => {
				const probe = (window as unknown as { __graphProbe: GraphProbe & { hidden: () => boolean } })
					.__graphProbe;
				const fake = (s: "hidden" | "visible") => {
					Object.defineProperty(document, "visibilityState", { configurable: true, get: () => s });
					document.dispatchEvent(new Event("visibilitychange"));
				};
				fake("hidden");
				await new Promise((r) => setTimeout(r, 200));
				const pausedWhenHidden = probe.hidden();
				fake("visible");
				await new Promise((r) => setTimeout(r, 200));
				const resumedWhenVisible = !probe.hidden();
				return { pausedWhenHidden, resumedWhenVisible };
			});
			console.log(
				`[close-hang] occlusion cycle: pausedWhenHidden=${occlusion.pausedWhenHidden} resumedWhenVisible=${occlusion.resumedWhenVisible}`,
			);
			expect(occlusion.pausedWhenHidden, "occluded graph must pause its loop").toBe(true);
			expect(
				occlusion.resumedWhenVisible,
				"graph must resume after an occlusion hidden→visible cycle (the zoom-stops-working bug)",
			).toBe(true);
		} finally {
			try {
				await app.close();
			} catch {
				/* already closed */
			}
		}
	} finally {
		rmSync(userDataDir, { recursive: true, force: true });
	}
});
