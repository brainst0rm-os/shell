/**
 * Resolve the real app-tab `Page` after launching an app.
 *
 * Since the window-management / tab-strip work, one app *window* is a
 * `BaseWindow` hosting several `WebContentsView`s — and each is a distinct
 * Playwright `page`: the privileged dashboard renderer
 * (`out/renderer/index.html`), the shell-drawn tab strip
 * (`out/renderer/chrome/tab-strip.html`), and the app tab itself
 * (`…/vault/apps/<id>/<ver>/dist/index.html`). `app.waitForEvent("window")`
 * resolves to whichever webContents finishes first — usually the tab strip —
 * so specs that then assert on app content time out.
 *
 * The app tab is the only page whose URL sits under `/apps/`. Poll for it.
 */

import type { ElectronApplication, Page } from "@playwright/test";

const APP_DIST_MARKER = "/apps/";

/** True for the app-tab page (its renderer is served from the vault's
 *  per-app dist), false for the shell renderer + the chrome tab strip. */
export function isAppTabPage(page: Page): boolean {
	return page.url().includes(APP_DIST_MARKER);
}

/** Launch `appId` from the dashboard and return the app-tab page (not the
 *  tab strip). Polls `app.windows()` because the tab strip and the app tab
 *  both fire `window` events and ordering isn't guaranteed. */
export async function launchAppPage(
	app: ElectronApplication,
	dashboard: Page,
	appId: string,
	opts: { timeout?: number } = {},
): Promise<Page> {
	const timeout = opts.timeout ?? 30_000;
	await dashboard.evaluate(
		(id) =>
			(
				window as unknown as { brainstorm: { apps: { launch: (id: string) => Promise<void> } } }
			).brainstorm.apps.launch(id),
		appId,
	);
	const page = await waitForAppTabPage(app, { timeout });
	await page.waitForLoadState("load", { timeout });
	return page;
}

/** Poll the open pages until one is an app-tab page (or time out). Use when
 *  a new app window is opened by something other than a direct dashboard
 *  launch (e.g. an in-app "open in new window"). */
export async function waitForAppTabPage(
	app: ElectronApplication,
	opts: { timeout?: number; ignore?: ReadonlySet<Page> } = {},
): Promise<Page> {
	const timeout = opts.timeout ?? 30_000;
	const ignore = opts.ignore ?? new Set<Page>();
	const deadline = Date.now() + timeout;
	for (;;) {
		const hit = app.windows().find((p) => !ignore.has(p) && isAppTabPage(p));
		if (hit) return hit;
		if (Date.now() > deadline) {
			const urls = app
				.windows()
				.map((p) => p.url())
				.join(", ");
			throw new Error(`waitForAppTabPage: no /apps/ page within ${timeout}ms — open pages: [${urls}]`);
		}
		await app.windows()[0]?.waitForTimeout(100);
	}
}
