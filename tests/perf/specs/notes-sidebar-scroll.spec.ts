/**
 * Notes sidebar scroll profiling — user-reported "clunky" interaction.
 *
 * Distinct from `editor-keystroke.spec.ts` (single discrete input → paint)
 * and `in-app-interaction.spec.ts:files-scroll` (which skips on empty
 * vaults). This one:
 *   1. seeds the vault with the BrainstormProject demo dataset so the
 *      sidebar has dozens of notes to scroll through;
 *   2. opens Notes;
 *   3. captures rAF→rAF frame deltas while it programmatically scrolls
 *      `.notes__sidebar-scroll` via mouse-wheel + via JS-set scrollTop.
 *
 * Two scroll modes because they exercise different paths:
 *   - **wheel** routes through the OS scroll deltas + the virtualizer's
 *     `scroll` listener (same code path as a real trackpad);
 *   - **scrollTop** drives the virtualizer directly + skips the OS event
 *     loop, isolating the virtualizer + row render cost.
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

const FRAMES = Number.parseInt(process.env.BS_PERF_INTERACTION_FRAMES ?? "90", 10);

async function ensureVaultSeededWithContent(dashboard: Page, userDataDir: string): Promise<void> {
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
						dev: {
							seedDemoApps: () => Promise<unknown>;
							reseedVault: () => Promise<unknown>;
						};
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
			if (!session) throw new Error("perf harness: no active vault after setup");
			await bs.dev.seedDemoApps();
			// reseedVault builds the BrainstormProject demo content (plan
			// iterations → Tasks, OQs → Notes, docs → Notes/Files). That's
			// what gives us a populated sidebar to scroll.
			await bs.dev.reseedVault();
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

test("notes sidebar scroll — wheel + scrollTop with real content", async () => {
	test.setTimeout(300_000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-perf-notes-sidebar-"));
	try {
		const launched = await launchShell({ userDataDir, timeoutMs: 120_000 });
		try {
			const dashboard = await launched.app.firstWindow({ timeout: 60_000 });
			await waitForFirstContentfulPaintAbsoluteMs(dashboard);
			await ensureVaultSeededWithContent(dashboard, userDataDir);

			const notes = await openApp(dashboard, launched.app, "io.brainstorm.notes");

			const sidebar = notes.locator(".notes__sidebar-scroll").first();
			await sidebar.waitFor({ state: "visible", timeout: 30_000 });

			// Confirm there's actually a scrollable amount of content; if the
			// seed undershot we should know rather than score a 0-frame median.
			const { rowCount, scrollHeight, clientHeight } = await sidebar.evaluate((el) => ({
				rowCount: el.querySelectorAll(".notes__sidebar-row").length,
				scrollHeight: (el as HTMLElement).scrollHeight,
				clientHeight: (el as HTMLElement).clientHeight,
			}));
			console.log(
				`[perf] notes sidebar: ${rowCount} rendered rows, scrollHeight=${scrollHeight}px clientHeight=${clientHeight}px`,
			);
			if (scrollHeight <= clientHeight + 50) {
				console.log(
					"[perf] notes sidebar: not enough content to scroll meaningfully — skipping wheel/scrollTop",
				);
				return;
			}

			// --- 1. wheel scroll (real OS path) ---
			await sidebar.hover();
			const wheelRecorder = recordFrameDeltas(notes, FRAMES);
			for (let i = 0; i < FRAMES; i++) {
				await notes.mouse.wheel(0, 80);
				await notes.waitForTimeout(8);
			}
			const wheelDeltas = await wheelRecorder;
			const wheelStats = summarize(wheelDeltas);
			const wheelPassed = wheelStats.median < BUDGETS.sustainedFrameTime.medianMs;
			console.log(
				`[perf] notes-sidebar wheel: ${formatStats(wheelStats)} budget=${BUDGETS.sustainedFrameTime.medianMs}ms (60fps)`,
			);
			appendResult(
				makeResult({
					spec: "notes-sidebar-scroll",
					scenario: "wheel",
					budget: BUDGETS.sustainedFrameTime,
					stats: wheelStats,
					passed: wheelPassed,
					note: wheelPassed
						? "median frame-time under sustained-frame budget scrolling Notes sidebar via mousewheel"
						: "median frame-time over sustained-frame budget scrolling Notes sidebar via mousewheel (sub-60fps)",
				}),
			);

			// Reset scroll position before the JS-driven pass.
			await sidebar.evaluate((el) => {
				(el as HTMLElement).scrollTop = 0;
			});
			await notes.waitForTimeout(200);

			// --- 1b. wheel scroll AFTER waiting for background work to settle ---
			// If wheel p99 drops vs the first pass, the spikes were caused by
			// concurrent main-thread work (canonical suspect: the per-note
			// `runVaultBodyMigration` plant that runs post-boot). 30s is past
			// the migration's expected wall time even with the
			// idle-yielded scheduler that lets gestures pause migration.
			await notes.waitForTimeout(30_000);
			await sidebar.hover();
			const wheelSettledRecorder = recordFrameDeltas(notes, FRAMES);
			for (let i = 0; i < FRAMES; i++) {
				await notes.mouse.wheel(0, 80);
				await notes.waitForTimeout(8);
			}
			const wheelSettledDeltas = await wheelSettledRecorder;
			const wheelSettledStats = summarize(wheelSettledDeltas);
			const wheelSettledPassed = wheelSettledStats.median < BUDGETS.sustainedFrameTime.medianMs;
			console.log(
				`[perf] notes-sidebar wheel (post-settle): ${formatStats(wheelSettledStats)} budget=${BUDGETS.sustainedFrameTime.medianMs}ms (60fps)`,
			);
			appendResult(
				makeResult({
					spec: "notes-sidebar-scroll",
					scenario: "wheel-after-settle",
					budget: BUDGETS.sustainedFrameTime,
					stats: wheelSettledStats,
					passed: wheelSettledPassed,
					note: wheelSettledPassed
						? "wheel after 8s settle — median under sustained-frame budget"
						: "wheel after 8s settle — median still over sustained-frame budget (jank not from post-boot background work)",
				}),
			);

			await sidebar.evaluate((el) => {
				(el as HTMLElement).scrollTop = 0;
			});
			await notes.waitForTimeout(200);

			// --- 2. JS scrollTop (virtualizer + row-render path only) ---
			const jsRecorder = recordFrameDeltas(notes, FRAMES);
			for (let i = 0; i < FRAMES; i++) {
				await sidebar.evaluate((el, dy) => {
					(el as HTMLElement).scrollTop += dy;
				}, 40);
				await notes.waitForTimeout(8);
			}
			const jsDeltas = await jsRecorder;
			const jsStats = summarize(jsDeltas);
			const jsPassed = jsStats.median < BUDGETS.sustainedFrameTime.medianMs;
			console.log(
				`[perf] notes-sidebar scrollTop: ${formatStats(jsStats)} budget=${BUDGETS.sustainedFrameTime.medianMs}ms (60fps)`,
			);
			appendResult(
				makeResult({
					spec: "notes-sidebar-scroll",
					scenario: "scrollTop",
					budget: BUDGETS.sustainedFrameTime,
					stats: jsStats,
					passed: jsPassed,
					note: jsPassed
						? "median frame-time under sustained-frame budget scrolling Notes sidebar via scrollTop"
						: "median frame-time over sustained-frame budget scrolling Notes sidebar via scrollTop (sub-60fps) — virtualizer/row-render bottleneck",
				}),
			);

			expect(wheelStats.samples + jsStats.samples, "no frame deltas captured").toBeGreaterThan(0);
		} finally {
			await launched.app.close();
		}
	} finally {
		rmSync(userDataDir, { recursive: true, force: true });
	}
});
