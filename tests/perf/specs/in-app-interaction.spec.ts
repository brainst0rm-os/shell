/**
 * In-app interaction profiling — frame-time samples while the user is
 * actively interacting. Complements the keystroke spec (which times a
 * single discrete input → paint) by measuring sustained interactions:
 *
 *   - Files: vertical scroll over the content list (proxies "scrolling
 *     a long list" interactions, including any virtualization gaps).
 *   - Whiteboard: cursor drag over the canvas wrap (proxies "panning
 *     the board" / "dragging a node" — the layer that hosts the most
 *     expensive paint path in the product).
 *
 * Measurement strategy: from the renderer side we open a frame-time
 * recorder (paired rAF callbacks → delta), drive the interaction from
 * Playwright in chunks the renderer can keep up with, then read back
 * the per-frame deltas. The "budget" we score against is the editor
 * `sustainedFrameTime` budget (17ms — one 60Hz frame interval); jank is anything over.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { BUDGETS } from "../lib/budgets";
import { launchShell } from "../lib/launch-shell";
import { waitForFirstContentfulPaintAbsoluteMs } from "../lib/measure-paint";
import { appendResult, makeResult } from "../lib/results";
import { formatStats, summarize } from "../lib/stats";

const INTERACTION_FRAMES = Number.parseInt(process.env.BS_PERF_INTERACTION_FRAMES ?? "60", 10);

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
				await bs.vaults.create({ name: "perf-fixture", path: `${userDataDir}/vault` });
				session = await bs.vaults.session();
			} else if (!session && list[0]) {
				await bs.vaults.activate(list[0].id);
				session = await bs.vaults.session();
			}
			if (!session) {
				throw new Error("perf harness: no active vault after setup");
			}
			await bs.dev.seedDemoApps();
		},
		{ userDataDir },
	);
}

async function openApp(
	dashboard: Page,
	app: Awaited<ReturnType<typeof launchShell>>["app"],
	appId: string,
): Promise<Page> {
	const newWindow = app.waitForEvent("window", { timeout: 30_000 });
	await dashboard.evaluate(
		(id) =>
			(
				window as unknown as { brainstorm: { apps: { launch: (id: string) => Promise<void> } } }
			).brainstorm.apps.launch(id),
		appId,
	);
	const win = await newWindow;
	await waitForFirstContentfulPaintAbsoluteMs(win);
	return win;
}

/**
 * Recorder: from a target page, collects raw rAF→rAF deltas (ms) for
 * `frameCount` frames. Caller drives an interaction concurrently;
 * deltas above the sustained-frame budget (17ms) indicate frame drops.
 */
async function recordFrameDeltas(page: Page, frameCount: number): Promise<number[]> {
	return page.evaluate(async (n) => {
		return new Promise<number[]>((resolve) => {
			const deltas: number[] = [];
			let last = performance.now();
			let frames = 0;
			const tick = (t: number) => {
				const dt = t - last;
				last = t;
				if (frames > 0) deltas.push(dt);
				frames += 1;
				if (frames > n) {
					resolve(deltas);
					return;
				}
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});
	}, frameCount);
}

test("in-app interaction — Files scroll", async () => {
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-perf-files-scroll-"));
	try {
		const launched = await launchShell({ userDataDir, timeoutMs: 120_000 });
		try {
			const dashboard = await launched.app.firstWindow({ timeout: 60_000 });
			await waitForFirstContentfulPaintAbsoluteMs(dashboard);
			await ensureVaultAndSeed(dashboard, userDataDir);

			const files = await openApp(dashboard, launched.app, "io.brainstorm.files");
			// Files renders list lazily; wait for at least one row OR an
			// empty-state to be present so the surface is stable.
			await files
				.locator('[data-testid="content-list"], [data-testid="content-empty"]')
				.first()
				.waitFor({ state: "visible", timeout: 30_000 });

			const list = files.locator('[data-testid="content-list"]').first();
			const exists = await list.count();
			if (exists === 0) {
				console.log("[perf] in-app:files-scroll — no content-list (empty vault?); skipping");
				return;
			}

			const recorder = recordFrameDeltas(files, INTERACTION_FRAMES);
			await list.hover();
			// Programmatic mousewheel from Playwright drives the same code path
			// as a real trackpad scroll, but with deterministic delta + cadence.
			for (let i = 0; i < INTERACTION_FRAMES; i++) {
				await files.mouse.wheel(0, 60);
				await files.waitForTimeout(8);
			}
			const deltas = await recorder;

			const stats = summarize(deltas);
			const passed = stats.median < BUDGETS.sustainedFrameTime.medianMs;
			console.log(
				`[perf] in-app files-scroll: ${formatStats(stats)} budget=${BUDGETS.sustainedFrameTime.medianMs}ms (60fps)`,
			);
			appendResult(
				makeResult({
					spec: "in-app-interaction",
					scenario: "files:scroll",
					budget: BUDGETS.sustainedFrameTime,
					stats,
					passed,
					note: passed
						? "median frame-time under sustained-frame budget while scrolling Files"
						: "median frame-time above sustained-frame budget while scrolling Files (sub-60fps)",
				}),
			);
		} finally {
			await launched.app.close();
		}
	} finally {
		rmSync(userDataDir, { recursive: true, force: true });
	}
});

test("in-app interaction — Whiteboard canvas pan", async () => {
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-perf-wb-pan-"));
	try {
		const launched = await launchShell({ userDataDir, timeoutMs: 120_000 });
		try {
			const dashboard = await launched.app.firstWindow({ timeout: 60_000 });
			await waitForFirstContentfulPaintAbsoluteMs(dashboard);
			await ensureVaultAndSeed(dashboard, userDataDir);

			const wb = await openApp(dashboard, launched.app, "io.brainstorm.whiteboard");
			const canvas = wb.locator(".whiteboard__canvas-wrap").first();
			await canvas.waitFor({ state: "visible", timeout: 30_000 });
			const box = await canvas.boundingBox();
			if (!box) {
				console.log("[perf] in-app:whiteboard-pan — canvas has no box; skipping");
				return;
			}
			const startX = box.x + box.width * 0.6;
			const startY = box.y + box.height * 0.6;
			const endX = box.x + box.width * 0.2;
			const endY = box.y + box.height * 0.3;

			const recorder = recordFrameDeltas(wb, INTERACTION_FRAMES);
			await wb.mouse.move(startX, startY);
			await wb.mouse.down();
			const steps = INTERACTION_FRAMES;
			for (let i = 1; i <= steps; i++) {
				const t = i / steps;
				await wb.mouse.move(startX + (endX - startX) * t, startY + (endY - startY) * t);
				await wb.waitForTimeout(8);
			}
			await wb.mouse.up();
			const deltas = await recorder;

			const stats = summarize(deltas);
			const passed = stats.median < BUDGETS.sustainedFrameTime.medianMs;
			console.log(
				`[perf] in-app whiteboard-pan: ${formatStats(stats)} budget=${BUDGETS.sustainedFrameTime.medianMs}ms (60fps)`,
			);
			appendResult(
				makeResult({
					spec: "in-app-interaction",
					scenario: "whiteboard:pan",
					budget: BUDGETS.sustainedFrameTime,
					stats,
					passed,
					note: passed
						? "median frame-time under sustained-frame budget while panning Whiteboard"
						: "median frame-time above sustained-frame budget while panning Whiteboard (sub-60fps)",
				}),
			);
			expect(stats.samples, "no frame deltas captured").toBeGreaterThan(0);
		} finally {
			await launched.app.close();
		}
	} finally {
		rmSync(userDataDir, { recursive: true, force: true });
	}
});
