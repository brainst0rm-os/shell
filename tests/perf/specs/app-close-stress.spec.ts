/**
 * Repro harness for the intermittent "shell hangs / crashes when I close apps
 * randomly" report. macOS crash reports show the MAIN process taking a SIGTRAP
 * (EXC_BREAKPOINT) — a native-level abort that bypasses the JS
 * `uncaughtException` handler. This spec hammers the real open → close(park) →
 * reopen → evict path across several apps while:
 *   - capturing the Electron child's stdout/stderr to a file (surfaces the
 *     fatal abort message / Rust panic / Chromium CHECK), and
 *   - pinging a worker-backed IPC after every round to detect a 30s hang, and
 *   - failing loudly if the Electron process exits mid-run.
 *
 * Not a budget assertion — a diagnostic. It prints the captured stderr tail on
 * failure so the abort reason is in the test output.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { launchShell } from "../lib/launch-shell";

const APP_IDS = [
	"io.brainstorm.notes",
	"io.brainstorm.tasks",
	"io.brainstorm.database",
	"io.brainstorm.graph",
	"io.brainstorm.journal",
];

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
				await bs.vaults.create({ name: "close-stress", path: `${userDataDir}/vault` });
				session = await bs.vaults.session();
			} else if (!session && list[0]) {
				await bs.vaults.activate(list[0].id);
				session = await bs.vaults.session();
			}
			if (!session) throw new Error("close-stress: no active vault after setup");
			await bs.dev.seedDemoApps();
		},
		{ userDataDir },
	);
}

async function launchApp(dashboard: Page, appId: string): Promise<void> {
	await dashboard.evaluate(
		(id) =>
			(
				window as unknown as { brainstorm: { apps: { launch: (id: string) => Promise<void> } } }
			).brainstorm.apps.launch(id),
		appId,
	);
}

async function closeAppWindows(dashboard: Page, appId: string): Promise<number> {
	return dashboard.evaluate(async (id) => {
		const bs = (
			window as unknown as {
				brainstorm: {
					windows: {
						list: () => Promise<Array<{ id: string; appId?: string }>>;
						close: (id: string) => Promise<boolean>;
					};
				};
			}
		).brainstorm;
		const list = await bs.windows.list();
		const mine = list.filter((w) => w.appId === id);
		for (const w of mine) await bs.windows.close(w.id);
		return mine.length;
	}, appId);
}

/** Worker-backed round-trip: list entities through the storage worker. Resolves
 *  fast in a healthy shell; a crashed/hung worker makes this reject or time out
 *  — our liveness probe for the "hang" half of the report. */
async function pingWorker(dashboard: Page): Promise<boolean> {
	return dashboard.evaluate(async () => {
		const bs = window as unknown as {
			brainstorm?: { dev?: { seedDemoApps?: () => Promise<unknown> } };
		};
		// `vaults.session()` round-trips to the main process + reads vault state;
		// cheap and always available. Good enough to detect a dead main loop.
		const v = (
			window as unknown as { brainstorm: { vaults: { session: () => Promise<unknown> } } }
		).brainstorm.vaults.session();
		const timeout = new Promise<never>((_, rej) =>
			setTimeout(() => rej(new Error("ipc-timeout")), 8000),
		);
		await Promise.race([v, timeout]);
		return !!bs.brainstorm;
	});
}

test.describe("app close stress (hang/crash repro)", () => {
	test("rapid open/close/reopen across apps stays alive", async () => {
		test.setTimeout(process.env.STRESS_GMALLOC ? 900_000 : 300_000);
		const userDataDir = mkdtempSync(join(tmpdir(), "bs-close-stress-"));
		// Capture path lives OUTSIDE userDataDir so the finally-block rmSync
		// doesn't delete it — we need the GuardMalloc banner + trap output.
		const capPath = join(tmpdir(), `bs-close-stress-stdio-${process.pid}.log`);
		let exited = false;
		// Optional: inject macOS libgmalloc into the Electron child (only) so a
		// heap-corruption WRITE traps at the exact instruction instead of
		// detonating later in an unrelated malloc. Slow + memory-heavy — pair with
		// a small STRESS_ROUNDS. Electron's dev binary is ad-hoc signed (no
		// hardened runtime) so DYLD_INSERT_LIBRARIES is honoured.
		const gmallocEnv: Record<string, string> | undefined = process.env.STRESS_GMALLOC
			? {
					DYLD_INSERT_LIBRARIES: "/usr/lib/libgmalloc.dylib",
					MALLOC_FILL_SPACE: "1",
					MALLOC_STRICT_SIZE: "1",
					MallocStackLoggingNoCompact: "1",
				}
			: undefined;
		// A/B knob: raise the parked-window cap so the over-cap eviction (which
		// destroys a *hidden* window — the suspected crash trigger) never runs.
		const capEnv: Record<string, string> | undefined = process.env.STRESS_MAX_PARKED
			? { BRAINSTORM_MAX_PARKED_WINDOWS: process.env.STRESS_MAX_PARKED }
			: undefined;
		const extraEnv = { ...(gmallocEnv ?? {}), ...(capEnv ?? {}) };
		try {
			const { app } = await launchShell({
				userDataDir,
				timeoutMs: gmallocEnv ? 300_000 : 120_000,
				stdioCapturePath: capPath,
				...(Object.keys(extraEnv).length > 0 ? { extraEnv } : {}),
			});
			app.process().on("exit", (code, signal) => {
				exited = true;
				console.log(`[close-stress] ELECTRON PROCESS EXITED code=${code} signal=${signal}`);
			});
			try {
				const dashboard = await app.firstWindow({ timeout: 60_000 });
				await dashboard.waitForLoadState("load", { timeout: 60_000 });
				await ensureVaultAndSeed(dashboard, userDataDir);

				const ROUNDS = Number(process.env.STRESS_ROUNDS ?? "24");
				for (let round = 0; round < ROUNDS; round++) {
					// Open a varying subset of apps.
					const open = APP_IDS.filter((_, i) => (i + round) % 2 === 0 || i === round % APP_IDS.length);
					for (const id of open) {
						await launchApp(dashboard, id);
						await dashboard.waitForTimeout(120);
					}
					await dashboard.waitForTimeout(250);

					// Close them in a round-dependent order (some rounds reverse).
					const order = round % 2 === 0 ? [...open] : [...open].reverse();
					for (const id of order) {
						await closeAppWindows(dashboard, id);
						await dashboard.waitForTimeout(80);
					}

					// Reopen one immediately (exercises un-park) then close again.
					const reopen = open[round % open.length];
					if (reopen) {
						await launchApp(dashboard, reopen);
						await dashboard.waitForTimeout(120);
						await closeAppWindows(dashboard, reopen);
					}

					expect(exited, `Electron exited during round ${round}`).toBe(false);
					const alive = await pingWorker(dashboard).catch((e) => {
						console.log(`[close-stress] ping failed round ${round}:`, (e as Error).message);
						return false;
					});
					expect(alive, `main/worker IPC hung at round ${round}`).toBe(true);
					if (round % 6 === 0) console.log(`[close-stress] round ${round} ok`);
				}
			} finally {
				await app.close().catch(() => undefined);
			}
		} finally {
			try {
				const cap = readFileSync(capPath, "utf8");
				const tail = cap.split("\n").slice(-80).join("\n");
				console.log("=== shell stdio tail ===\n", tail);
			} catch {
				console.log("[close-stress] no stdio capture file");
			}
			rmSync(userDataDir, { recursive: true, force: true });
		}
	});
});
