/**
 * Per-state capture primitives.
 *
 * `captureAppState` launches the app via the dashboard's
 * `brainstorm.apps.launch(appId)`, waits for the new window's first paint,
 * runs the state's optional setup, lets the renderer settle, then writes a
 * PNG. The window is closed afterward so each capture starts from a cold
 * launch — slower than reusing a single window, but it avoids
 * cross-contamination between states (an open popover from a prior state
 * leaking into the next screenshot).
 *
 * `captureShellState` screenshots the dashboard renderer itself; no app
 * window is opened.
 */

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import { launchAppPage } from "./app-window";
import type { AppVisualSpec, ShellVisualSpec, VisualState } from "./state-registry";

const POST_SETUP_SETTLE_MS = 250;

/**
 * Wait until an app window is ready to screenshot. We don't gate on
 * first-contentful-paint here (the perf harness uses FCP for measurement,
 * but an empty/loading app legitimately never fires FCP, which was causing
 * spurious 30s timeouts in the visual harness). Instead: wait for the
 * `load` event so the bundle has executed + first frame has rendered, then
 * try to wait for `.app-header` (the cross-app chrome marker) — if that
 * never shows up, fall back to a fixed settle so apps that don't yet use
 * the convention still capture.
 */
async function waitForAppReady(page: Page): Promise<void> {
	await page.waitForLoadState("load", { timeout: 30_000 });
	await page
		.waitForSelector(".app-header, body > div", { state: "attached", timeout: 5_000 })
		.catch(() => {});
	await page.waitForTimeout(150);
}

async function writePngAtomic(page: Page, outPath: string): Promise<void> {
	await mkdir(dirname(outPath), { recursive: true });
	await page.screenshot({ path: outPath, type: "png", fullPage: false });
}

export async function captureAppState(opts: {
	app: ElectronApplication;
	dashboard: Page;
	spec: AppVisualSpec;
	state: VisualState;
	outPath: string;
}): Promise<void> {
	const { app, dashboard, spec, state, outPath } = opts;
	// The app window is a BaseWindow hosting the tab strip + the app tab as
	// separate webContents; `launchAppPage` resolves the app-tab page (the tab
	// strip would otherwise win the `window` race and we'd screenshot chrome).
	const appWindow = await launchAppPage(app, dashboard, spec.appId);
	try {
		await waitForAppReady(appWindow);
		if (state.setup) {
			try {
				await state.setup(appWindow);
			} catch (err) {
				throw new Error(`${spec.appId}/${state.name}: state setup failed — ${(err as Error).message}`);
			}
		}
		await appWindow.waitForTimeout(POST_SETUP_SETTLE_MS);
		await writePngAtomic(appWindow, outPath);
	} finally {
		await appWindow.close().catch(() => {});
	}
}

export async function captureShellState(opts: {
	dashboard: Page;
	spec: ShellVisualSpec;
	state: VisualState;
	outPath: string;
}): Promise<void> {
	const { dashboard, spec, state, outPath } = opts;
	if (state.setup) {
		try {
			await state.setup(dashboard);
		} catch (err) {
			throw new Error(`${spec.id}/${state.name}: state setup failed — ${(err as Error).message}`);
		}
	}
	await dashboard.waitForTimeout(POST_SETUP_SETTLE_MS);
	await writePngAtomic(dashboard, outPath);
}
