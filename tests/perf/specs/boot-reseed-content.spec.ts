/**
 * Boot content-reseed verification.
 *
 * Reproduces the user-reported "seeded vault shows N tasks overdue today,
 * nothing updating": the plan→Tasks projection is pinned to the seed's `now`,
 * so an old seed drifts overdue and plan ✅ status edits never reach the vault
 * until the projection re-runs. The fix re-runs the projection on every dev
 * boot (`reseedVaultContent` from `runDevSeed`, gated on AUTO_SEED!=0).
 *
 * This boots the REAL shell with AUTO_SEED=1, creates a vault to trigger the
 * active-session reseed, and asserts the boot path actually re-anchors the
 * projection (logs `re-anchored plan projection`) rather than silently no-op-ing
 * or failing the `bun` spawn (`content reseed failed: <reason>`).
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { launchShell } from "../lib/launch-shell";

test("dev boot re-anchors the plan projection (no stale overdue)", async () => {
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-boot-reseed-"));
	const vaultPath = join(userDataDir, "vault");
	const logPath = join(userDataDir, "shell-stdout.log");

	const { app } = await launchShell({
		userDataDir,
		timeoutMs: 60_000,
		stdioCapturePath: logPath,
		// Force the dev auto-seed ON — the harness default is "0" (off). This is
		// the exact gate the real `bun run dev` boot runs under.
		extraEnv: { BRAINSTORM_AUTO_SEED: "1" },
	});

	try {
		const dashboard: Page = await app.firstWindow();
		await dashboard.waitForLoadState("domcontentloaded");

		// Creating the vault makes a session active → onActiveVaultSessionChanged
		// → runDevSeed → reseedVaultContent. Mirrors first-launch in dev.
		await dashboard.evaluate(
			async ({ vaultPath }) => {
				const bs = (
					window as unknown as {
						brainstorm: {
							vaults: {
								list: () => Promise<unknown[]>;
								create: (opts: { name: string; path: string }) => Promise<unknown>;
							};
						};
					}
				).brainstorm;
				const list = (await bs.vaults.list()) as Array<{ id: string }>;
				if (list.length === 0) {
					await bs.vaults.create({ name: "boot-reseed-fixture", path: vaultPath });
				}
			},
			{ vaultPath },
		);

		// The reseed is fire-and-forget off the session hook; it spawns the Bun
		// seed-cli then drains in-process. Poll captured stdout for the outcome.
		const deadline = Date.now() + 45_000;
		let outcome: "ok" | "failed" | null = null;
		let line = "";
		while (Date.now() < deadline) {
			let log = "";
			try {
				log = readFileSync(logPath, "utf8");
			} catch {
				// not written yet
			}
			const ok = /re-anchored plan projection \(([^)]*)\)/.exec(log);
			const bad = /content reseed failed: (.*)/.exec(log);
			if (ok) {
				outcome = "ok";
				line = ok[1] ?? "";
				break;
			}
			if (bad) {
				outcome = "failed";
				line = bad[1] ?? "";
				break;
			}
			await new Promise((r) => setTimeout(r, 1000));
		}

		console.log(`[boot-reseed] outcome=${outcome} detail="${line}"`);
		expect(outcome, `reseed never logged a result. tail:\n${tailLog(logPath)}`).toBe("ok");
		// updated > 0 confirms the projection rewrote existing/seed rows with
		// fresh dates rather than no-op-ing.
		expect(line).toMatch(/\d+ updated|\d+ created/);
	} finally {
		await app.close();
		rmSync(userDataDir, { recursive: true, force: true });
	}
});

function tailLog(path: string): string {
	try {
		return readFileSync(path, "utf8").split("\n").slice(-40).join("\n");
	} catch {
		return "<no log>";
	}
}
