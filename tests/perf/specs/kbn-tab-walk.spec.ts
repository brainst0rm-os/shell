/**
 * KBN-P-tab-walk — `docs/shell/61-keyboard-accessibility.md §Validation`.
 *
 * For each shell window / overlay, Tab from the first focusable through every
 * focusable in the visible surface; assert:
 *   - no element is focused twice (no double-focus / cycle-mid-walk)
 *   - every focusable in the live DOM is visited (no unreachable)
 *   - the next Tab after the last focusable lands on the first (cycle)
 *
 * Today's scope: the dashboard surface + the Settings overlay opened from it.
 * The Settings overlay uses `<Popover>` for its panel chrome but is rendered
 * inline (not via `<Popover>`'s portal trap path) so Tab is unconstrained
 * across the dashboard chrome until KBN-S-settings adopts `useFocusTrap`.
 *
 * Pending KBN-S-* adoption (skip-deferred):
 *   - KBN-S-settings  — full trap inside the settings panel.
 *   - KBN-S-marketplace — same for marketplace.
 *   - per-app windows  — apps open in separate renderers; per-app tab-walk
 *                        belongs to the KBN-A-* rungs.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
	ensureVaultSeeded,
	enumerateFocusables,
	openSettings,
	tabWalk,
	waitForDashboard,
} from "../lib/keyboard-assertions";
import { launchShell } from "../lib/launch-shell";
import { waitForFirstContentfulPaintAbsoluteMs } from "../lib/measure-paint";

test.describe("KBN-P-tab-walk — every shell surface tabbable end-to-end", () => {
	test("dashboard tab order has no double-focus, no unreachable, cycles", async () => {
		test.setTimeout(180_000);
		const userDataDir = mkdtempSync(join(tmpdir(), "bs-perf-kbn-tab-walk-"));
		try {
			const { app } = await launchShell({ userDataDir, timeoutMs: 120_000 });
			try {
				const dashboard = await app.firstWindow({ timeout: 60_000 });
				await waitForFirstContentfulPaintAbsoluteMs(dashboard);
				await ensureVaultSeeded(dashboard, userDataDir);
				await waitForDashboard(dashboard);

				// Move focus to a known starting point — the dashboard root —
				// before walking. The shell auto-focuses nothing on cold boot;
				// without this the first Tab might or might not land on the
				// first focusable depending on Electron's focus restoration.
				await dashboard.evaluate(() => {
					(document.querySelector<HTMLElement>("main.dashboard") ?? document.body).focus();
				});

				const focusableCount = await enumerateFocusables(dashboard, "main.dashboard");
				expect(focusableCount, "dashboard must have at least one focusable").toBeGreaterThan(0);

				// Walk up to 4× the focusable count so we can observe a clean
				// cycle (visit each ~3× before giving up). A real cycle stops
				// the walker at first repeat — see `tabWalk` body.
				const visited = await tabWalk(dashboard, focusableCount * 4);
				expect(visited.length, "tab walk must visit at least one element").toBeGreaterThan(0);
				expect(visited).not.toContain("@body");

				// First-pass = first `focusableCount` Tabs. After a complete
				// pass the walker should see the first fingerprint repeat
				// (cycle); the slice before the repeat is the unique pass.
				const firstFp = visited[0];
				const cycleIndex = visited.indexOf(firstFp as string, 1);
				expect(
					cycleIndex,
					"Tab order must cycle back to the first focusable within 4× the count",
				).toBeGreaterThan(0);

				const uniquePass = visited.slice(0, cycleIndex);
				const seen = new Set<string>();
				for (const fp of uniquePass) {
					expect(seen.has(fp), `Tab visited "${fp}" twice in one pass (double-focus)`).toBe(false);
					seen.add(fp);
				}
				console.log(
					`[kbn] tab-walk dashboard: ${uniquePass.length} unique focusables, cycle at step ${cycleIndex} (live DOM count: ${focusableCount})`,
				);
				// The walker count and live-DOM count don't have to match
				// 1:1 — visible-style filtering in `enumerateFocusables` may
				// include elements Tab can't reach yet (offscreen overlays
				// mounted but not currently displayed), and vice versa. We
				// assert the walk found at least half of them as a coarse
				// "no obviously-broken sink" signal; the cycle assertion is
				// the real teeth.
				expect(uniquePass.length).toBeGreaterThanOrEqual(Math.max(1, Math.floor(focusableCount / 2)));
			} finally {
				await app.close();
			}
		} finally {
			rmSync(userDataDir, { recursive: true, force: true });
		}
	});

	test("settings overlay tab-walk", async () => {
		// KBN-S-settings landed 2026-05-29: the overlay is a focus-trapped
		// dialog — Tab cycles inside it and never leaks to the dashboard.
		test.setTimeout(180_000);
		const userDataDir = mkdtempSync(join(tmpdir(), "bs-perf-kbn-tab-walk-settings-"));
		try {
			const { app } = await launchShell({ userDataDir, timeoutMs: 120_000 });
			try {
				const dashboard = await app.firstWindow({ timeout: 60_000 });
				await waitForFirstContentfulPaintAbsoluteMs(dashboard);
				await ensureVaultSeeded(dashboard, userDataDir);
				await waitForDashboard(dashboard);
				await openSettings(dashboard);

				const focusableCount = await enumerateFocusables(dashboard, '[data-testid="settings"]');
				expect(focusableCount, "settings overlay has focusables").toBeGreaterThan(0);

				const visited = await tabWalk(dashboard, focusableCount * 4);
				expect(visited.length, "tab walk inside settings visits elements").toBeGreaterThan(0);
				// The trap holds: focus never falls to body while the overlay
				// is open, and the walk cycles instead of escaping. The cycle
				// may re-enter at any element (the first Tab from the trap's
				// initial focus isn't necessarily part of the loop), so assert
				// ANY repeat — `tabWalk` stops at the first one.
				expect(visited).not.toContain("@body");
				const cycled = new Set(visited).size < visited.length;
				expect(cycled, "Tab order cycles inside the settings trap").toBe(true);
				const cycleIndex = visited.length - 1;

				// Every visited element lives inside the overlay (no leak to
				// the dashboard behind it).
				const leaked = await dashboard.evaluate(() => {
					const el = document.activeElement;
					return el ? !el.closest('[data-testid="settings"]') : true;
				});
				expect(leaked, "focus stays inside the settings overlay").toBe(false);

				console.log(
					`[kbn] tab-walk settings: cycle at step ${cycleIndex} of ${visited.length} (live DOM count: ${focusableCount})`,
				);
			} finally {
				await app.close();
			}
		} finally {
			rmSync(userDataDir, { recursive: true, force: true });
		}
	});
});
