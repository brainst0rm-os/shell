/**
 * RTL shell smoke — Stage 12.5 (shell-half).
 *
 * Flips `<html dir="rtl">` on a freshly launched shell and verifies the
 * structural pieces that the 12.5 sweep made locale-aware actually mirror:
 *   - Logical-property edges (Settings panel `border-inline-start`,
 *     sidebar `border-inline-end`) move to the visually-opposite side.
 *   - The shared inline-axis icon-mirror rule
 *     (`[dir="rtl"] [data-icon-direction="inline"] { transform: scaleX(-1) }`)
 *     resolves to a real `matrix(-1, …)` against a stamped svg.
 *   - Settings still renders end-to-end without overflow clipping.
 *
 * Per OQ-53 tentative leaning ("visual-regression on a shell smoke set;
 * manual testing for app authors"). The apps-side CSS sweep is deferred to
 * 12.5b; this spec only fences the shell-half.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ElectronApplication, expect, test } from "@playwright/test";

import { launchShell } from "../lib/launch-shell";
import { ensureVaultAndSeed } from "../lib/seed-vault";

test("RTL shell smoke — Settings panel mirrors + inline-axis icon rule flips", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-rtl-"));
	let app: ElectronApplication | null = null;
	try {
		const launched = await launchShell({ userDataDir });
		app = launched.app;
		const dashboard = await app.firstWindow({ timeout: 60_000 });
		await dashboard.waitForLoadState("load", { timeout: 60_000 });
		await ensureVaultAndSeed(dashboard, userDataDir);

		// Feedback-3 slice 2 — the first-time changelog popover auto-mounts
		// on a freshly-seeded vault. Stash "seen the newest" so it stays
		// out of the way (same pattern as keyboard-rebind.spec.ts).
		await dashboard.evaluate(async () => {
			const bs = (
				window as unknown as {
					brainstorm: {
						help: { getChangelog: () => Promise<{ releases: Array<{ version: string }> }> };
						dashboard: { setLastSeenChangelogVersion: (v: string) => Promise<unknown> };
					};
				}
			).brainstorm;
			const cl = await bs.help.getChangelog();
			const newest = cl.releases[0]?.version;
			if (newest) await bs.dashboard.setLastSeenChangelogVersion(newest);
		});
		const openPopover = dashboard.locator('div[role="dialog"][aria-modal="true"]');
		if ((await openPopover.count()) > 0) {
			await dashboard.keyboard.press("Escape");
		}

		// Capture LTR baseline rects for the Settings panel + sidebar so the
		// RTL flip can be checked geometrically (panel.right - sidebar.right
		// > 0 in LTR — sidebar is on the inline-start; the same delta flips
		// sign in RTL).
		await dashboard.getByRole("button", { name: "Settings" }).click();
		await dashboard.waitForSelector(".settings__panel", { state: "visible", timeout: 30_000 });
		await dashboard.waitForSelector(".settings__sidebar", { state: "visible", timeout: 30_000 });

		const ltr = await dashboard.evaluate(() => {
			const panel = document.querySelector(".settings__panel");
			const sidebar = document.querySelector(".settings__sidebar");
			if (!panel || !sidebar) return null;
			const p = panel.getBoundingClientRect();
			const s = sidebar.getBoundingClientRect();
			return { panelLeft: p.left, panelRight: p.right, sidebarLeft: s.left, sidebarRight: s.right };
		});
		expect(ltr).not.toBeNull();
		if (ltr === null) return;
		// In LTR the Settings sidebar sits on the inline-start = left edge of
		// the panel.
		expect(ltr.sidebarLeft).toBeCloseTo(ltr.panelLeft, 0);

		// Flip to RTL — inject a stamped svg into the panel so we can check
		// the inline-axis icon-mirror rule resolved against a real element
		// without having to open an app whose nav-buttons would be visible.
		await dashboard.evaluate(() => {
			document.documentElement.setAttribute("dir", "rtl");
			const probe = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			probe.id = "rtl-smoke-probe";
			probe.setAttribute("width", "16");
			probe.setAttribute("height", "16");
			probe.setAttribute("data-icon-direction", "inline");
			probe.style.position = "absolute";
			probe.style.top = "0";
			probe.style.left = "0";
			document.body.appendChild(probe);
		});

		// Layout has to repaint with the new direction. A short wait + an
		// rAF tick is enough; the DOM is already in place.
		await dashboard.waitForTimeout(150);

		// The settings panel + sidebar mirror — sidebar now hugs the inline-
		// start which in RTL is the visual right edge of the panel.
		const rtl = await dashboard.evaluate(() => {
			const panel = document.querySelector(".settings__panel");
			const sidebar = document.querySelector(".settings__sidebar");
			if (!panel || !sidebar) return null;
			const p = panel.getBoundingClientRect();
			const s = sidebar.getBoundingClientRect();
			return { panelLeft: p.left, panelRight: p.right, sidebarLeft: s.left, sidebarRight: s.right };
		});
		expect(rtl).not.toBeNull();
		if (rtl === null) return;
		// In RTL the sidebar's right edge aligns with the panel's right edge.
		expect(rtl.sidebarRight).toBeCloseTo(rtl.panelRight, 0);
		// And it is NOT flush against the panel's left edge any more.
		expect(rtl.sidebarLeft - rtl.panelLeft).toBeGreaterThan(50);

		// The inline-axis icon-mirror rule resolves against a stamped svg:
		// `transform: scaleX(-1)` → computed `matrix(-1, 0, 0, 1, 0, 0)`.
		const probeTransform = await dashboard.evaluate(() => {
			const probe = document.getElementById("rtl-smoke-probe");
			if (!probe) return null;
			return getComputedStyle(probe).transform;
		});
		expect(probeTransform).toBe("matrix(-1, 0, 0, 1, 0, 0)");

		// Sanity: a non-stamped sibling does NOT mirror — the rule is scoped
		// to the data attribute, not all SVGs in RTL.
		const negativeTransform = await dashboard.evaluate(() => {
			const probe = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			probe.id = "rtl-smoke-probe-bidi";
			probe.setAttribute("width", "16");
			probe.setAttribute("height", "16");
			document.body.appendChild(probe);
			return getComputedStyle(probe).transform;
		});
		// jsdom/Chromium returns "none" when no transform applies.
		expect(negativeTransform).toBe("none");

		// Settings is still rendered end-to-end (the body content scrolls;
		// nothing got clipped or removed by the dir flip).
		await dashboard.waitForSelector(".settings__main", { state: "visible", timeout: 5_000 });
		await dashboard.waitForSelector(".settings__body", { state: "visible", timeout: 5_000 });
	} finally {
		if (app) await app.close();
		rmSync(userDataDir, { recursive: true, force: true });
	}
});
