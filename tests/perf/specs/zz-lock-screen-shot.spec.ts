import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchShell } from "../lib/launch-shell";

test("capture lock screen via real UI", async () => {
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-lock-"));

	// First launch: create vault through the real Welcome UI, then set a PIN.
	{
		const { app } = await launchShell({ userDataDir });
		const dashboard = await app.firstWindow();
		await dashboard.waitForLoadState("domcontentloaded");
		// Create via UI so VaultProvider state updates.
		await dashboard.getByText("Create a new vault").click();
		await dashboard.locator(".welcome__form").waitFor();
		await dashboard.getByRole("button", { name: "Create vault" }).click();
		// Dashboard should mount.
		await dashboard.locator(".dashboard").waitFor({ timeout: 15000 });
		await dashboard.evaluate(async () => {
			const bs = (
				window as unknown as { brainstorm: { vaults: { setPin: (pin: string) => Promise<void> } } }
			).brainstorm;
			await bs.vaults.setPin("123456");
		});
		await app.close();
	}

	// Second launch: open recent vault via UI → Dashboard → lock → LockScreen.
	{
		const { app } = await launchShell({ userDataDir });
		const dashboard = await app.firstWindow();
		await dashboard.waitForLoadState("domcontentloaded");
		await dashboard.locator(".welcome__recent-item").first().click();
		await dashboard.waitForTimeout(4000);
		console.log("AFTER_CLICK_HTML_START");
		console.log(
			(await dashboard.evaluate(() => document.getElementById("root")?.outerHTML ?? "")).slice(
				0,
				1500,
			),
		);
		console.log("AFTER_CLICK_HTML_END");
		// Engage the app-lock (same path as the lock button / auto-lock).
		await dashboard.evaluate(async () => {
			const bs = (window as unknown as { brainstorm: { vaults: { lock: () => Promise<void> } } })
				.brainstorm;
			await bs.vaults.lock();
		});
		await dashboard.locator(".lock-screen").waitFor({ timeout: 10000 });
		await dashboard.waitForTimeout(500);
		await dashboard.screenshot({ path: "tests/perf/results/lock-screen.png" });
		const html = await dashboard.evaluate(() => document.getElementById("root")?.outerHTML ?? "");
		console.log("LOCKSCREEN_HTML_START");
		console.log(html);
		console.log("LOCKSCREEN_HTML_END");
		await app.close();
	}
	expect(true).toBe(true);
});
