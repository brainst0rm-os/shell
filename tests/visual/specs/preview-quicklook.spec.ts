/**
 * Preview cross-app open verification (post React migration 9.20.12).
 *
 * Drives the REAL delivery path the unit suite can't reach: Files creates a
 * `brainstorm/File/v1` entity, dispatches `quick-look`, the intents bus
 * launches Preview with the bare-entityId handshake, Preview resolves it via
 * the capability-gated `entities.get` and mounts the text renderer.
 *
 * Also asserts `fetch("brainstorm://…")` is reachable under Preview's CSP —
 * `connect-src` must include `brainstorm:` or every fetch-based renderer
 * (text/markdown/code/pdf/audio) fails on real vault attachments. A CSP
 * block and a 404 are distinguishable: block → TypeError, reachable → HTTP
 * status.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type ConsoleMessage, expect, test } from "@playwright/test";
import { launchAppPage, waitForAppTabPage } from "../lib/app-window";
import { launchShell } from "../lib/launch-shell";
import { ensureVaultAndSeed } from "../lib/seed-vault";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const SCREENSHOT_DIR = join(REPO_ROOT, ".screenshots", "preview-quicklook");

test("quick-look from Files opens Preview and renders the file", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-preview-ql-"));
	const { app } = await launchShell({ userDataDir });
	try {
		const dashboard = await app.firstWindow({ timeout: 60_000 });
		await dashboard.waitForLoadState("load", { timeout: 60_000 });
		await ensureVaultAndSeed(dashboard, userDataDir);

		const files = await launchAppPage(app, dashboard, "io.brainstorm.files");

		const result = await files.evaluate(async () => {
			const bs = (
				window as unknown as {
					brainstorm: {
						services: {
							entities: {
								create: (type: string, properties: Record<string, unknown>) => Promise<{ id: string }>;
							};
							intents: {
								dispatch: (intent: {
									verb: string;
									payload: Record<string, unknown>;
								}) => Promise<{ handled: boolean; reason?: string } | null>;
							};
						};
					};
				}
			).brainstorm;
			const entity = await bs.services.entities.create("brainstorm/File/v1", {
				name: "hello.txt",
				mime: "text/plain",
				attachment: "data:text/plain,hello%20from%20preview%20verify",
			});
			const dispatch = await bs.services.intents.dispatch({
				verb: "quick-look",
				payload: { entityId: entity.id, mime: "text/plain" },
			});
			return { entityId: entity.id, dispatch };
		});
		expect(
			result.dispatch?.handled,
			`quick-look dispatch failed: ${JSON.stringify(result.dispatch)}`,
		).toBe(true);

		const preview = await waitForAppTabPage(app, {
			ignore: new Set([files]),
			timeout: 30_000,
		});
		const consoleErrors: string[] = [];
		preview.on("console", (m: ConsoleMessage) => {
			if (m.type() === "error") consoleErrors.push(m.text());
		});
		await preview.waitForLoadState("load", { timeout: 30_000 });

		await expect(preview.locator(".preview__filename")).toHaveText("hello.txt", {
			timeout: 20_000,
		});
		await expect(preview.locator(".preview__render-host")).toContainText(
			"hello from preview verify",
			{ timeout: 20_000 },
		);

		await preview.screenshot({ path: join(SCREENSHOT_DIR, "preview-text.png") });
		expect(consoleErrors, `renderer console errors:\n${consoleErrors.join("\n")}`).toEqual([]);

		// CSP probe: fetch("brainstorm://…") must be reachable from Preview —
		// real attachments are brainstorm:// URLs, and the text/markdown/code/
		// pdf/audio renderers all fetch() them. A CSP block surfaces as a
		// thrown TypeError; reachability as an HTTP status (404 for a missing
		// asset). Guards the `connect-src … brainstorm:` directive.
		const cspProbe = await preview.evaluate(async () => {
			try {
				const res = await fetch(`brainstorm://asset/${"0".repeat(36)}`);
				return `status:${res.status}`;
			} catch (e) {
				return `error:${(e as Error).message}`;
			}
		});
		expect(cspProbe, "brainstorm:// fetch is CSP-blocked in Preview").toMatch(/^status:/);
	} finally {
		await app.close();
	}
});
