/**
 * Books library + inspector smoke (real shell + seeded vault).
 *
 * Proves the fixes for "imported book never lists / inspector dead / panel
 * doesn't look like Notes":
 *   - the shelf reads its Book/v1 rows via the type-scoped `entities.query`
 *     (NOT the `entities.read:*`-gated `vaultEntities.list()`), so a created
 *     book appears WITHOUT the wildcard capability Books deliberately lacks;
 *   - selecting it opens the right-panel inspector (works for a real book,
 *     not just the in-memory sample);
 *   - the left panel uses the shared `<Searchbar>` + recency sections (the
 *     Notes-sidebar look), with no `.bs-select` sort dropdown.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect, test } from "@playwright/test";
import { launchAppPage } from "../lib/app-window";
import { launchShell } from "../lib/launch-shell";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const SCREENSHOT_DIR = join(REPO_ROOT, ".screenshots", "books-library");

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
				await bs.vaults.create({ name: "books-fixture", path: `${userDataDir}/vault` });
				session = await bs.vaults.session();
			} else if (!session && list[0]) {
				await bs.vaults.activate(list[0].id);
				session = await bs.vaults.session();
			}
			if (!session) throw new Error("books harness: no active vault after setup");
			await bs.dev.seedPrebuiltApps();
		},
		{ userDataDir },
	);
	await dashboard.reload({ waitUntil: "domcontentloaded" });
	await dashboard.waitForSelector(".dashboard", { state: "visible", timeout: 30_000 });
}

test("books library lists a created book, opens its inspector, and uses the Notes-style shell", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-books-library-"));
	const { app } = await launchShell({ userDataDir });
	try {
		const dashboard = await app.firstWindow({ timeout: 60_000 });
		await dashboard.waitForLoadState("load", { timeout: 60_000 });
		await ensureVaultAndPrebuiltApps(dashboard, userDataDir);

		const books = await launchAppPage(app, dashboard, "io.brainstorm.books");
		await books.waitForSelector("#books-library", { state: "visible", timeout: 30_000 });

		// The left panel is the Notes-style shell: shared Searchbar, NO sort
		// dropdown.
		await expect(books.locator("#books-library .bs-searchbar")).toBeVisible({ timeout: 10_000 });
		await expect(books.locator("#books-library .bs-select")).toHaveCount(0);
		await books.screenshot({ path: join(SCREENSHOT_DIR, "01-empty.png"), fullPage: false });

		// Create a File/v1 + Book/v1 through the app's OWN capability-gated
		// entities service — exactly what the import flow does after the picker.
		await books.evaluate(async () => {
			const bs = (
				window as unknown as {
					brainstorm: {
						services: {
							entities: {
								create: (
									type: string,
									properties: Record<string, unknown>,
									id?: string,
								) => Promise<{ id: string }>;
							};
						};
					};
				}
			).brainstorm;
			const file = await bs.services.entities.create("brainstorm/File/v1", {
				name: "lotr.pdf",
				attachment: "brainstorm://asset/fixture",
				mime: "application/pdf",
			});
			const id = "bk_fixture_1";
			await bs.services.entities.create(
				"brainstorm/Book/v1",
				{
					id,
					name: "The Lord of the Rings",
					format: "pdf",
					author: "",
					fileId: file.id,
					spineLength: 0,
					reading: { position: null, progress: 0, lastReadAt: null },
					createdAt: 1,
					updatedAt: 1,
				},
				id,
			);
		});

		// The shelf must now list the book (recency section + row) — the bug
		// was an empty panel because `vaultEntities.list()` was cap-denied.
		const row = books.locator(".books__row", { hasText: "The Lord of the Rings" });
		await expect(row).toBeVisible({ timeout: 20_000 });
		await expect(books.locator(".books__library-section")).toHaveCount(1, { timeout: 10_000 });
		await books.screenshot({ path: join(SCREENSHOT_DIR, "02-listed.png"), fullPage: false });

		// Selecting the real book opens the right-panel inspector (worked only
		// for the sample before, because `selectedBook` came from the empty list).
		await row.click({ timeout: 10_000 });
		await expect(books.locator(".bs-props--open")).toBeVisible({ timeout: 15_000 });
		await books.screenshot({ path: join(SCREENSHOT_DIR, "03-inspector.png"), fullPage: false });

		await books.close().catch(() => {});
	} finally {
		await app.close().catch(() => {});
		rmSync(userDataDir, { recursive: true, force: true });
	}
});
