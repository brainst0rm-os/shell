/**
 * Contacts two-pane + compose-popover smoke.
 *
 * Boots the real shell + seeded vault, opens Contacts, and proves the
 * reworked surface end-to-end: the persistent left sidebar renders next to
 * the content pane, "New contact" opens the shared compose popover (no
 * entity minted until submit — cancelling leaves the list unchanged), and
 * submitting creates + selects the contact (active sidebar row, editable
 * card name, properties panel open, ⋯ object menu last in the header).
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type ConsoleMessage, type Page, expect, test } from "@playwright/test";
import { launchAppPage } from "../lib/app-window";
import { launchShell } from "../lib/launch-shell";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const SCREENSHOT_DIR = join(REPO_ROOT, ".screenshots", "contacts-two-pane");

/** Vault + PREBUILT app install (no in-process vite build — `seedDemoApps`
 *  would build every first-party app and blow the test budget; the spec's
 *  contract is "every apps/<id>/dist is already built", same as the e2e
 *  smoke). */
async function ensureVaultAndPrebuiltApps(dashboard: Page, userDataDir: string): Promise<void> {
	await dashboard.evaluate(
		async ({ userDataDir }) => {
			const bs = (
				window as unknown as {
					brainstorm: {
						vaults: {
							list: () => Promise<Array<{ id: string }>>;
							create: (opts: { name: string; path: string }) => Promise<unknown>;
							activate: (id: string) => Promise<unknown>;
							session: () => Promise<unknown>;
						};
						dev: { seedPrebuiltApps: () => Promise<unknown> };
					};
				}
			).brainstorm;
			const list = await bs.vaults.list();
			let session = await bs.vaults.session();
			if (list.length === 0) {
				await bs.vaults.create({ name: "visual-fixture", path: `${userDataDir}/vault` });
				session = await bs.vaults.session();
			} else if (!session && list[0]) {
				await bs.vaults.activate(list[0].id);
				session = await bs.vaults.session();
			}
			if (!session) throw new Error("visual harness: no active vault after setup");
			await bs.dev.seedPrebuiltApps();
		},
		{ userDataDir },
	);
	// Imperative vault creation happens outside the React tree — reload so the
	// VaultProvider sees the active session (same as the shared seed helper).
	await dashboard.reload({ waitUntil: "domcontentloaded" });
	await dashboard.waitForSelector(".dashboard", { state: "visible", timeout: 30_000 });
}

test("contacts shows a persistent list sidebar and creates via the compose popover", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-contacts-pane-"));
	const { app } = await launchShell({ userDataDir });
	try {
		const dashboard = await app.firstWindow({ timeout: 60_000 });
		await dashboard.waitForLoadState("load", { timeout: 60_000 });
		await ensureVaultAndPrebuiltApps(dashboard, userDataDir);

		const consoleErrors: string[] = [];
		const trackConsole = (msg: ConsoleMessage) => {
			if (msg.type() === "error") consoleErrors.push(msg.text());
		};

		const contacts = await launchAppPage(app, dashboard, "io.brainstorm.contacts");
		contacts.on("console", trackConsole);
		contacts.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

		// Two-pane shell: sidebar + content render together under one header.
		await contacts.waitForSelector("#contacts-sidebar", { state: "visible", timeout: 30_000 });
		await expect(contacts.locator(".contacts__content")).toBeVisible({ timeout: 10_000 });
		await expect(contacts.locator('[data-testid="app-header"]')).toHaveCount(1);
		const rowsBefore = await contacts.locator(".contacts-row").count();
		await contacts.screenshot({ path: join(SCREENSHOT_DIR, "01-two-pane.png"), fullPage: false });

		// Cancelling the compose popover mints nothing.
		await contacts.locator('[data-testid="contacts-new"]').click({ timeout: 10_000 });
		const compose = contacts.locator('[data-testid="contacts-compose"]');
		await expect(compose).toBeVisible({ timeout: 10_000 });
		const createBtn = contacts.locator('[data-testid="contacts-compose-create"]');
		await expect(createBtn).toBeDisabled();
		await contacts.keyboard.press("Escape");
		await expect(compose).toHaveCount(0, { timeout: 10_000 });
		await expect(contacts.locator(".contacts-row")).toHaveCount(rowsBefore);

		// Submitting creates + selects the contact.
		await contacts.locator('[data-testid="contacts-new"]').click({ timeout: 10_000 });
		await contacts
			.locator('[data-testid="contacts-compose-name"]')
			.fill("Pane Smoke", { timeout: 10_000 });
		await expect(createBtn).toBeEnabled();
		await contacts.screenshot({ path: join(SCREENSHOT_DIR, "02-compose.png"), fullPage: false });
		await createBtn.click({ timeout: 10_000 });
		await expect(compose).toHaveCount(0, { timeout: 10_000 });

		// Detail pane shows the editable card name; the sidebar row is active.
		await expect(contacts.locator(".contacts-detail__name-input")).toHaveValue("Pane Smoke", {
			timeout: 15_000,
		});
		await expect(
			contacts.locator(".contacts-row--active .contacts-row__name", { hasText: "Pane Smoke" }),
		).toBeVisible({ timeout: 15_000 });
		// Properties panel is open by default; the ⋯ object menu sits in the header.
		await expect(contacts.locator(".bs-props--open")).toBeVisible({ timeout: 10_000 });
		await expect(contacts.locator('[data-testid="app-header"] .bs-object-menu__more')).toBeVisible({
			timeout: 10_000,
		});
		await contacts.screenshot({ path: join(SCREENSHOT_DIR, "03-detail.png"), fullPage: false });

		expect(
			consoleErrors,
			`unexpected console errors:\n${consoleErrors.map((e) => `  - ${e}`).join("\n")}`,
		).toEqual([]);

		await contacts.close().catch(() => {});
	} finally {
		await app.close().catch(() => {});
		if (existsSync(userDataDir)) rmSync(userDataDir, { recursive: true, force: true });
	}
});
