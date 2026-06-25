/**
 * One-shot diagnostic — dumps the Notes app's actual ledger grants from
 * a freshly-installed shell, so we can see WHY Notes is getting denied
 * even though its manifest declares the caps.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ElectronApplication, expect, test } from "@playwright/test";
import { launchShell } from "../lib/launch-shell";
import { ensureVaultAndSeed } from "../lib/seed-vault";

test("ledger contains Notes' manifest caps", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-notes-caps-"));
	let app: ElectronApplication | null = null;
	try {
		const launched = await launchShell({ userDataDir });
		app = launched.app;
		const dashboard = await app.firstWindow({ timeout: 60_000 });
		await dashboard.waitForLoadState("load", { timeout: 60_000 });
		await ensureVaultAndSeed(dashboard, userDataDir);

		// Inspect what `ledger.listActive("io.brainstorm.notes")` returns
		// from inside main. Use bs.ledger.listActive (the preload bridge —
		// per CLAUDE.md the shell exposes this; if not, this fails fast).
		const grants = await dashboard.evaluate(async () => {
			const bs = (window as unknown as { brainstorm: Record<string, unknown> }).brainstorm;
			const ledger = bs.ledger as
				| { listGrantsByApp: () => Promise<Record<string, unknown[]>> }
				| undefined;
			if (!ledger?.listGrantsByApp) return { error: "no bs.ledger.listGrantsByApp bridge" };
			const all = await ledger.listGrantsByApp();
			return { notes: all["io.brainstorm.notes"] };
		});
		console.log("[notes-caps-diag] GRANTS", JSON.stringify(grants, null, 2));
		expect(grants).toBeDefined();
	} finally {
		if (app) await app.close().catch(() => {});
		rmSync(userDataDir, { recursive: true, force: true });
	}
});
