import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchShell } from "../lib/launch-shell";

// Throwaway: does the appearance toggle actually flip the :root theme?
test("appearance toggle flips the theme (button path + shortcut)", async () => {
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-theme-"));
	const { app } = await launchShell({ userDataDir });
	const dashboard = await app.firstWindow();
	dashboard.on("console", (m) => console.log(`[renderer:${m.type()}] ${m.text()}`));
	await dashboard.waitForLoadState("domcontentloaded");
	await dashboard.getByText("Create a new vault").click();
	await dashboard.locator(".welcome__form").waitFor();
	await dashboard.getByRole("button", { name: "Create vault" }).click();
	await dashboard.locator(".dashboard").waitFor({ timeout: 15000 });
	await dashboard.waitForTimeout(1500);

	const readTheme = () => dashboard.evaluate(() => document.documentElement.dataset.theme ?? "?");
	const readMode = () =>
		dashboard.evaluate(async () => {
			const bs = (
				window as unknown as {
					brainstorm: {
						dashboard: {
							snapshot: () => Promise<{ appearance?: { mode?: string } } | undefined>;
						};
					};
				}
			).brainstorm;
			const snap = await bs.dashboard.snapshot();
			return snap?.appearance?.mode ?? "?";
		});

	const theme0 = await readTheme();
	const mode0 = await readMode();
	console.log(`INITIAL theme=${theme0} mode=${mode0}`);

	// Button path: click the real appearance-toggle button in the top bar.
	const btn = dashboard.getByRole("button", { name: /appearance|light|dark|theme/i });
	console.log(`toggle buttons matched: ${await btn.count()}`);
	await btn.first().click();
	await dashboard.waitForTimeout(1200);
	const theme1 = await readTheme();
	const mode1 = await readMode();
	console.log(`AFTER button click: theme=${theme1} mode=${mode1}`);

	// Control: does ANY main-routed Cmd+Shift+<letter> chord reach the app
	// via Playwright keystrokes? Cmd+Shift+K opens the cheatsheet overlay.
	await dashboard.keyboard.press("Meta+Shift+K");
	await dashboard.waitForTimeout(800);
	const cheatsheetOpen = await dashboard
		.locator(".cheatsheet, [data-testid='cheatsheet'], [role='dialog']")
		.count();
	console.log(`AFTER Cmd+Shift+K: cheatsheet/dialog count=${cheatsheetOpen}`);
	await dashboard.keyboard.press("Escape");
	await dashboard.waitForTimeout(400);

	// Shortcut path: real Cmd+Shift+L keystroke.
	await dashboard.keyboard.press("Meta+Shift+L");
	await dashboard.waitForTimeout(1200);
	const theme2 = await readTheme();
	const mode2 = await readMode();
	console.log(`AFTER Cmd+Shift+L: theme=${theme2} mode=${mode2}`);

	await app.close();

	expect(theme1, "theme should change after button click").not.toBe(theme0);
});
