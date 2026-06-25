/**
 * Whiteboard connector-styling end-to-end smoke (9.17.16).
 *
 * Boots the real Electron shell, adds two stickies, connects them (via the
 * `__brainstormWhiteboardDev` hook — a synthetic Playwright pointer can't
 * drive `setPointerCapture`, so the handle-drag can't be exercised directly),
 * selects the connector, then drives the Style ▾ menu (which lists connector
 * rows when an edge is selected) to switch routing, add a dashed line, mark it
 * bidirectional, and recolour it — asserting the live edge model updates with
 * no renderer console errors. The pure transforms are unit-tested
 * (edge-style.test.ts) + the codec round-trip (codec.test.ts); this proves the
 * select → menu → mutate → persist wiring against the live app.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type ConsoleMessage, expect, test } from "@playwright/test";
import { waitForAppTabPage } from "../lib/app-window";
import { launchShell } from "../lib/launch-shell";
import { ensureVaultAndSeed } from "../lib/seed-vault";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const SCREENSHOT_DIR = join(REPO_ROOT, ".screenshots", "whiteboard-connector-style");

type EdgeState = {
	pathKind: string;
	arrowHead: string;
	sourceArrowHead: string | null;
	dashed: boolean;
	colorHint: string | null;
};

type Dev = {
	nodeIds: () => string[];
	connect: (a: string, b: string) => string | null;
	selectEdge: (id: string) => void;
	edgeState: (id: string) => EdgeState | null;
};

test("whiteboard Style menu restyles a selected connector", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-wb-conn-"));
	const { app } = await launchShell({ userDataDir });
	try {
		const dashboard = await app.firstWindow({ timeout: 60_000 });
		await dashboard.waitForLoadState("load", { timeout: 60_000 });
		await ensureVaultAndSeed(dashboard, userDataDir);

		const consoleErrors: string[] = [];
		const trackConsole = (msg: ConsoleMessage) => {
			if (msg.type() === "error") consoleErrors.push(msg.text());
		};

		await dashboard.evaluate(() =>
			(
				window as unknown as { brainstorm: { apps: { launch: (id: string) => Promise<void> } } }
			).brainstorm.apps.launch("io.brainstorm.whiteboard"),
		);
		const wb = await waitForAppTabPage(app);
		wb.on("console", trackConsole);
		await wb.waitForLoadState("load", { timeout: 30_000 });
		await wb.waitForSelector(".whiteboard__canvas", { state: "visible", timeout: 30_000 });

		// Two stickies to connect.
		await wb.locator(".whiteboard__add-trigger").click();
		await wb.locator(".fm-menu .fm-row", { hasText: "Sticky note" }).click();
		await wb.locator(".whiteboard__add-trigger").click();
		await wb.locator(".fm-menu .fm-row", { hasText: "Sticky note" }).click();
		await expect(wb.locator(".whiteboard__node")).toHaveCount(2, { timeout: 10_000 });

		// Connect them + select the connector via the dev hook.
		const edgeId = await wb.evaluate(() => {
			const dev = (window as unknown as { __brainstormWhiteboardDev: Dev }).__brainstormWhiteboardDev;
			const [a, b] = dev.nodeIds();
			if (!a || !b) throw new Error("expected two nodes");
			const id = dev.connect(a, b);
			if (!id) throw new Error("connect rejected");
			dev.selectEdge(id);
			return id;
		});

		const edgeState = () =>
			wb.evaluate(
				(id) =>
					(window as unknown as { __brainstormWhiteboardDev: Dev }).__brainstormWhiteboardDev.edgeState(
						id,
					),
				edgeId,
			);

		// Default connector is a right-angle (step) Arrow, solid, unmarked source.
		expect((await edgeState())?.pathKind).toBe("step");

		// Style ▾ → Route: Straight.
		await wb.locator(".whiteboard__style-trigger").click();
		await wb.locator(".fm-menu .fm-row", { hasText: "Route: Straight" }).click();
		await expect.poll(async () => (await edgeState())?.pathKind).toBe("straight");

		// Style ▾ → Dashed line.
		await wb.locator(".whiteboard__style-trigger").click();
		await wb.locator(".fm-menu .fm-row", { hasText: "Dashed line" }).click();
		await expect.poll(async () => (await edgeState())?.dashed).toBe(true);

		// Style ▾ → Both ends arrowed.
		await wb.locator(".whiteboard__style-trigger").click();
		await wb.locator(".fm-menu .fm-row", { hasText: "Both ends arrowed" }).click();
		await expect.poll(async () => (await edgeState())?.sourceArrowHead).toBe("arrow");

		// Style ▾ → Colour: Blue.
		await wb.locator(".whiteboard__style-trigger").click();
		await wb.locator(".fm-menu .fm-row", { hasText: "Colour: Blue" }).click();
		await expect.poll(async () => (await edgeState())?.colorHint).toBe("#3b82f6");

		await wb.screenshot({ path: join(SCREENSHOT_DIR, "01-styled.png"), fullPage: false });

		expect(
			consoleErrors,
			`unexpected console errors:\n${consoleErrors.map((e) => `  - ${e}`).join("\n")}`,
		).toEqual([]);

		await wb.close().catch(() => {});
	} finally {
		await app.close().catch(() => {});
		if (existsSync(userDataDir)) {
			rmSync(userDataDir, { recursive: true, force: true });
		}
	}
});
