/**
 * Bookmarks tag-board drag-and-drop regression (user report 2026-06-11:
 * "dragging bookmarks between tags does nothing and resets horizontal
 * scroll").
 *
 * Drives the real handlers with synthetic DragEvents (native HTML5 DnD is
 * unreliable under Playwright; the handler↔native pipeline was verified
 * once via CDP Input.dispatchDragEvent) and asserts the three fixes:
 *   1. a mid-drag vault change does NOT rebuild the board (a rebuild
 *      destroys the drag source and Chromium cancels the drag — the
 *      "drop does nothing" failure);
 *   2. the drop moves the card between lanes (and the deferred render
 *      flushes);
 *   3. the board's horizontal scroll survives the post-drop repaint.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ConsoleMessage, expect, test } from "@playwright/test";
import { waitForAppTabPage } from "../lib/app-window";
import { launchShell } from "../lib/launch-shell";
import { ensureVaultAndSeed } from "../lib/seed-vault";

test("bookmarks board: card drop retags across lanes, mid-drag refresh deferred, scroll kept", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-bm-board-"));
	const { app } = await launchShell({ userDataDir });
	try {
		const dashboard = await app.firstWindow({ timeout: 60_000 });
		await dashboard.waitForLoadState("load", { timeout: 60_000 });
		await ensureVaultAndSeed(dashboard, userDataDir);

		const reseed = await dashboard.evaluate(async () => {
			const bs = (
				window as unknown as {
					brainstorm: { dev: { reseedVault: () => Promise<{ ok: boolean; reason?: string }> } };
				}
			).brainstorm;
			return bs.dev.reseedVault();
		});
		expect(reseed.ok, `seed-cli failed: ${reseed.reason ?? ""}`).toBe(true);

		const consoleErrors: string[] = [];
		const trackConsole = (msg: ConsoleMessage) => {
			if (msg.type() === "error") consoleErrors.push(msg.text());
		};

		await dashboard.evaluate(() =>
			(
				window as unknown as { brainstorm: { apps: { launch: (id: string) => Promise<void> } } }
			).brainstorm.apps.launch("io.brainstorm.bookmarks"),
		);
		const bm = await waitForAppTabPage(app);
		bm.on("console", trackConsole);
		await bm.waitForLoadState("load", { timeout: 30_000 });
		await bm.waitForSelector(".bookmarks__card", { state: "visible", timeout: 30_000 });

		await bm.locator(".bookmarks__nav-btn", { hasText: "Tag board" }).click();
		await bm.waitForSelector(".bookmarks__tag-board", { state: "visible", timeout: 10_000 });
		// Let the first-open dictionary-ensure write + its refresh settle so the
		// drag below races only against the write this test injects.
		await bm.waitForTimeout(1200);

		// Start a synthetic card drag from the first named lane.
		const start = await bm.evaluate(() => {
			const lanes = [...document.querySelectorAll<HTMLElement>(".bookmarks__tag-board")].filter(
				(b) => b.dataset.laneTag,
			);
			if (lanes.length < 2) return null;
			const src = lanes[0] as HTMLElement;
			const dst = lanes[1] as HTMLElement;
			const card = src.querySelector<HTMLElement>(".bookmarks__card[data-entity-id]");
			if (!card) return null;
			const wrap = document.querySelector<HTMLElement>(".bookmarks__tag-boards");
			if (wrap) wrap.scrollLeft = 120;
			// Marker proves the board DOM is NOT rebuilt while the drag is live.
			src.dataset.probeMarker = "alive";
			const dt = new DataTransfer();
			(window as unknown as { __probeDt: DataTransfer }).__probeDt = dt;
			card.dispatchEvent(
				new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }),
			);
			// A bookmark in NEITHER of the two lanes, to mutate mid-drag.
			const other = [...document.querySelectorAll<HTMLElement>(".bookmarks__card[data-entity-id]")]
				.map((c) => c.getAttribute("data-entity-id"))
				.find(
					(id) =>
						id &&
						!src.querySelector(`[data-entity-id="${id}"]`) &&
						!dst.querySelector(`[data-entity-id="${id}"]`),
				);
			return {
				id: card.getAttribute("data-entity-id"),
				fromTag: src.dataset.laneTag ?? null,
				toTag: dst.dataset.laneTag ?? null,
				otherId: other ?? null,
				scrollLeft: wrap?.scrollLeft ?? -1,
			};
		});
		expect(start, "need 2 named lanes + a card").not.toBeNull();
		if (!start) return;
		expect(start.scrollLeft).toBeGreaterThan(0); // lanes overflow → scrollable

		// Mid-drag: a real vault write (bumps the entity's store revision, so
		// the live store DOES see a change) — the render must be deferred, not
		// tear down the board under the drag.
		if (start.otherId) {
			await bm.evaluate(async (id) => {
				const bs = (
					window as unknown as {
						brainstorm: {
							services: {
								entities: {
									update: (id: string, patch: Record<string, unknown>) => Promise<unknown>;
								};
							};
						};
					}
				).brainstorm;
				await bs.services.entities.update(id, { notes: `probe ${id}` });
			}, start.otherId);
		}
		await bm.waitForTimeout(800); // past the store's coalesce window

		const midDrag = await bm.evaluate(() => ({
			markerAlive:
				document.querySelector<HTMLElement>("[data-probe-marker]")?.dataset.probeMarker ?? null,
			scrollLeft: document.querySelector<HTMLElement>(".bookmarks__tag-boards")?.scrollLeft ?? -1,
		}));
		expect(midDrag.markerAlive, "board must not rebuild while a drag is live").toBe("alive");
		expect(midDrag.scrollLeft).toBe(start.scrollLeft);

		// Drop on the second named lane; then the deferred render flushes.
		await bm.evaluate((toTag) => {
			const dst = document.querySelector<HTMLElement>(
				`.bookmarks__tag-board[data-lane-tag="${toTag}"]`,
			);
			const dt = (window as unknown as { __probeDt: DataTransfer }).__probeDt;
			if (!dst || !dt) return;
			dst.dispatchEvent(
				new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }),
			);
			dst.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
		}, start.toTag);
		await bm.waitForTimeout(1500); // include the save → live-refresh round-trip

		const after = await bm.evaluate(() => ({
			lanes: [...document.querySelectorAll<HTMLElement>(".bookmarks__tag-board")].map((b) => ({
				tag: b.dataset.laneTag ?? null,
				cards: [...b.querySelectorAll<HTMLElement>(".bookmarks__card")].map(
					(c) => c.getAttribute("data-entity-id") ?? "?",
				),
			})),
			markerAlive: document.querySelector("[data-probe-marker]") !== null,
			scrollLeft: document.querySelector<HTMLElement>(".bookmarks__tag-boards")?.scrollLeft ?? -1,
		}));
		const dstLane = after.lanes.find((l) => l.tag === start.toTag);
		const srcLane = after.lanes.find((l) => l.tag === start.fromTag);
		expect(dstLane?.cards ?? [], "card lands in the target lane").toContain(start.id);
		expect(srcLane?.cards ?? [], "card leaves the source lane").not.toContain(start.id);
		expect(after.markerAlive, "deferred render flushed after the drop").toBe(false);
		expect(after.scrollLeft, "horizontal scroll survives the post-drop repaint").toBe(
			start.scrollLeft,
		);

		expect(
			consoleErrors,
			`unexpected console errors:\n${consoleErrors.map((e) => `  - ${e}`).join("\n")}`,
		).toEqual([]);

		await bm.close().catch(() => {});
	} finally {
		await app.close().catch(() => {});
		if (existsSync(userDataDir)) {
			rmSync(userDataDir, { recursive: true, force: true });
		}
	}
});
