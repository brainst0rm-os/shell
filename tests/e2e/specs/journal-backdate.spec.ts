/**
 * Journal back/forward-dating regression — an empty day that ISN'T today must
 * be an editable surface (placeholder editable), not the dead read-only "No
 * entry yet." line. Reproduces the user-reported bug: navigating to a past or
 * future day left no editable, so typing did nothing and the slash menu
 * anchored at (0,0). Asserts the rendered surface (no synthetic keystrokes —
 * those corrupt the Yjs-bound editor in headless Electron, per the Journal dev
 * plugin's note), which is exactly the gate the fix changed.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchShell } from "../../perf/lib/launch-shell";
import { launchAppPage } from "../../visual/lib/app-window";

type Brainstorm = {
	vaults: {
		list: () => Promise<Array<{ id: string }>>;
		create: (o: { name: string; path: string }) => Promise<unknown>;
		activate: (id: string) => Promise<unknown>;
	};
	dev: { seedPrebuiltApps: () => Promise<unknown> };
};

/** First of the current month — a real past day (the run date is mid-month),
 *  in the month the Journal mini-calendar shows on open, so it's directly
 *  clickable without paging. */
function pastDayKeyInCurrentMonth(): string {
	const now = new Date();
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, "0");
	return `${y}-${m}-01`;
}

test("journal — an empty past day is editable, not a dead 'No entry yet.' line", async () => {
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-e2e-journal-"));
	try {
		const { app } = await launchShell({ userDataDir });
		try {
			const dashboard = await app.firstWindow({ timeout: 60_000 });
			await dashboard.evaluate(
				async ({ userDataDir }) => {
					const bs = (window as unknown as { brainstorm: Brainstorm }).brainstorm;
					const list = await bs.vaults.list();
					if (list.length === 0) {
						await bs.vaults.create({ name: "e2e-journal", path: `${userDataDir}/vault` });
					} else if (list[0]) {
						await bs.vaults.activate(list[0].id);
					}
					await bs.dev.seedPrebuiltApps();
				},
				{ userDataDir },
			);

			const journal = await launchAppPage(app, dashboard, "io.brainstorm.journal");

			// Navigate to a past, empty day via the nav mini-calendar (cells carry
			// `data-date-key="YYYY-MM-DD"`).
			const pastKey = pastDayKeyInCurrentMonth();
			const cell = journal.locator(`[data-date-key="${pastKey}"]`).first();
			await cell.waitFor({ state: "visible", timeout: 30_000 });
			await cell.click();

			// The fix: that empty past day renders the implicit-create placeholder
			// editable, and NOT the read-only "No entry yet." empty state.
			await expect(journal.locator(".journal__write-placeholder")).toBeVisible({ timeout: 10_000 });
			await expect(journal.locator(".journal__write-placeholder")).toHaveAttribute(
				"contenteditable",
				"true",
			);
			await expect(journal.locator(".journal__empty")).toHaveCount(0);
		} finally {
			await app.close();
		}
	} finally {
		rmSync(userDataDir, { recursive: true, force: true });
	}
});
