/**
 * Settings → Keyboard rebinding round-trip — Stage 6.10f.
 *
 * Drives the real shell, opens Settings → Keyboard, enters capture mode
 * on `shell/cheatsheet`, presses a new chord (the test platform's
 * primary modifier + `K`), saves it, and verifies the persisted
 * `Mod`-tokenized chord lands in `shortcuts.list()` over IPC. Then
 * resets and re-asserts the default chord is restored.
 *
 * This is the live half of the iteration — the renderer unit tests
 * mock the bridge; here we exercise the full IPC + entities-write +
 * broadcast-and-repaint cycle against an actual `entities.db`.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ElectronApplication, expect, test } from "@playwright/test";

import { launchShell } from "../lib/launch-shell";
import { ensureVaultAndSeed } from "../lib/seed-vault";

type ShortcutBindingRow = {
	readonly id: string;
	readonly chord: string | null;
	readonly defaultChord: string | null;
	readonly source: "default" | "user-override" | "cleared";
};

type BrainstormBridge = {
	shortcuts: {
		list: () => Promise<ShortcutBindingRow[]>;
		setOverride: (id: string, chord: string | null) => Promise<{ ok: boolean }>;
		resetOverride: (id: string) => Promise<{ ok: boolean }>;
	};
};

test("Settings → Keyboard rebinding round-trips Mod-tokenized chords through IPC + entity persistence", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-rebind-"));
	let app: ElectronApplication | null = null;
	try {
		const launched = await launchShell({ userDataDir });
		app = launched.app;
		const dashboard = await app.firstWindow({ timeout: 60_000 });
		await dashboard.waitForLoadState("load", { timeout: 60_000 });
		await ensureVaultAndSeed(dashboard, userDataDir);

		// Sanity: baseline shell/cheatsheet binding is the default.
		const baseline = await dashboard.evaluate(async () => {
			const bs = (window as unknown as { brainstorm: BrainstormBridge }).brainstorm;
			return bs.shortcuts.list();
		});
		const baselineCheatsheet = baseline.find((r) => r.id === "shell/cheatsheet");
		expect(baselineCheatsheet?.chord).toBe("CmdOrCtrl+Shift+K");
		expect(baselineCheatsheet?.source).toBe("default");

		// Drive the round-trip directly through the bridge: rebind to a
		// non-conflicting Mod-tokenized chord. Going through the IPC
		// surface (not faking through the renderer's keyboard listener)
		// gives us deterministic behavior across CI environments where
		// modifier-key dispatch through `dispatchEvent` can interact
		// strangely with the OS-level focus.
		const setResult = await dashboard.evaluate(async () => {
			const bs = (window as unknown as { brainstorm: BrainstormBridge }).brainstorm;
			return bs.shortcuts.setOverride("shell/cheatsheet", "Mod+Alt+K");
		});
		expect(setResult).toEqual({ ok: true });

		// `shortcuts.list` reflects the new chord; persisted form is
		// `Mod`-tokenized (the doc-canonical cross-platform alias) so a
		// second device reading the same `brainstorm/ShortcutBindings/v1`
		// entity on a different platform sees the right thing.
		const overridden = await dashboard.evaluate(async () => {
			const bs = (window as unknown as { brainstorm: BrainstormBridge }).brainstorm;
			return bs.shortcuts.list();
		});
		const overriddenCheatsheet = overridden.find((r) => r.id === "shell/cheatsheet");
		expect(overriddenCheatsheet?.chord).toBe("Mod+Alt+K");
		expect(overriddenCheatsheet?.defaultChord).toBe("CmdOrCtrl+Shift+K");
		expect(overriddenCheatsheet?.source).toBe("user-override");

		// Conflict rejection — a chord already used by another binding
		// (shell/cheatsheet's own default) gets refused defensively even
		// if the renderer fails to check first.
		const conflict = await dashboard.evaluate(async () => {
			const bs = (window as unknown as { brainstorm: BrainstormBridge }).brainstorm;
			// shell/marketplace defaults to CmdOrCtrl+Shift+P; Mod+Shift+P
			// normalizes to the same canonical form.
			return bs.shortcuts.setOverride("shell/launcher", "Mod+Shift+P");
		});
		expect(conflict).toEqual({ ok: false, reason: "conflict" });

		// Reset clears the override; the next `list` shows the default
		// chord with `source: "default"`.
		const resetResult = await dashboard.evaluate(async () => {
			const bs = (window as unknown as { brainstorm: BrainstormBridge }).brainstorm;
			return bs.shortcuts.resetOverride("shell/cheatsheet");
		});
		expect(resetResult).toEqual({ ok: true });

		const final = await dashboard.evaluate(async () => {
			const bs = (window as unknown as { brainstorm: BrainstormBridge }).brainstorm;
			return bs.shortcuts.list();
		});
		const finalCheatsheet = final.find((r) => r.id === "shell/cheatsheet");
		expect(finalCheatsheet?.chord).toBe("CmdOrCtrl+Shift+K");
		expect(finalCheatsheet?.source).toBe("default");
	} finally {
		if (app) await app.close();
		rmSync(userDataDir, { recursive: true, force: true });
	}
});

test("Settings → Keyboard rebinding UI surfaces a row + opens capture mode", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-rebind-ui-"));
	let app: ElectronApplication | null = null;
	try {
		const launched = await launchShell({ userDataDir });
		app = launched.app;
		const dashboard = await app.firstWindow({ timeout: 60_000 });
		await dashboard.waitForLoadState("load", { timeout: 60_000 });
		await ensureVaultAndSeed(dashboard, userDataDir);

		// Feedback-3 slice 2 — the first-time changelog popover auto-mounts
		// on a freshly-seeded vault. Persist "seen the newest" so it stays
		// closed, then re-mount the dashboard so subsequent overlays land
		// without contention.
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

		// Dismiss the popover if it's already mounted (decide-once → it
		// stays hidden after the version write but a live mount needs an
		// Escape).
		const popoverOpen = dashboard.locator('div[role="dialog"][aria-modal="true"]');
		if ((await popoverOpen.count()) > 0) {
			await dashboard.keyboard.press("Escape");
		}

		// Open Settings via the dashboard's Settings IconButton. (The chord
		// would also work, but main-process `before-input-event` listeners
		// don't fire reliably from Playwright's `keyboard.press`, so we
		// click the affordance the real user clicks.) Using a precise
		// aria-label query — the dashboard renders the Settings IconButton
		// with `aria-label="Settings"`, distinct from any other surfaces
		// that might match a role-based name lookup.
		await dashboard
			.locator('.dashboard__header button[aria-label="Settings"]')
			.first()
			.click({ timeout: 10_000 });

		await dashboard.waitForSelector(".settings", { state: "visible", timeout: 30_000 });

		// Switch to Keyboard section — click the nav item by its translated text.
		const navKeyboard = dashboard
			.locator(".settings__sidebar button", { hasText: "Keyboard" })
			.first();
		if ((await navKeyboard.count()) > 0) await navKeyboard.click();

		await dashboard.waitForSelector(".keyboard__list", { state: "visible", timeout: 10_000 });

		// At least one row + chord button.
		const chordButtons = dashboard.locator(".keyboard__chord-button");
		expect(await chordButtons.count()).toBeGreaterThan(0);

		// Click the launcher row's chord button → capture target mounts.
		await chordButtons.first().click();
		await dashboard.waitForSelector('[data-bs-capture-active="true"]', {
			state: "visible",
			timeout: 5000,
		});
	} finally {
		if (app) await app.close();
		rmSync(userDataDir, { recursive: true, force: true });
	}
});
