import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	ipcMain: { handle: vi.fn() },
	BrowserWindow: { getAllWindows: () => [] },
}));

import { setAppLockPin } from "../credentials/app-lock-pin";
import {
	VaultSession,
	closeActiveVaultSession,
	resetAppLockStateForTests,
	setActiveVaultSession,
} from "../vault/session";
import { makeVaultLockHandlers } from "./vault-lock-handlers";

describe("vault-lock-handlers (13.8c)", () => {
	let vaultDir: string;
	let prevInsecure: string | undefined;

	beforeEach(async () => {
		vaultDir = await mkdtemp(join(tmpdir(), "brainstorm-vlh-"));
		// The IPC handler calls `lockActiveVault()` with no open-options (correct
		// for production: the hard-lock re-pick gets the keyring by default, or the
		// insecure backend when this env flag is set). Mirror env-driven insecure
		// dev here so the unlock re-pick selects the same backend the vault used.
		prevInsecure = process.env.BRAINSTORM_DEV_INSECURE_CREDENTIALS;
		process.env.BRAINSTORM_DEV_INSECURE_CREDENTIALS = "1";
	});

	afterEach(async () => {
		vi.useRealTimers();
		resetAppLockStateForTests();
		closeActiveVaultSession();
		// biome-ignore lint/performance/noDelete: `delete` is the only way to truly unset an env var (assigning undefined coerces to the string "undefined")
		if (prevInsecure === undefined) delete process.env.BRAINSTORM_DEV_INSECURE_CREDENTIALS;
		else process.env.BRAINSTORM_DEV_INSECURE_CREDENTIALS = prevInsecure;
		await rm(vaultDir, { recursive: true, force: true });
	});

	it("does not broadcast when there is no active vault to lock", () => {
		const broadcast = vi.fn();
		const h = makeVaultLockHandlers(broadcast);
		expect(h.lock()).toEqual({ locked: false });
		expect(broadcast).not.toHaveBeenCalled();
		expect(h.status()).toEqual({ locked: false });
	});

	it("broadcasts locked=true on lock and locked=false on successful unlock", async () => {
		const session = await VaultSession.create({
			vaultId: "vlt_ipc",
			vaultPath: vaultDir,
			forceInsecure: true,
		});
		setActiveVaultSession(session);
		await setAppLockPin(session.backend, "vlt_ipc", "1234");

		const broadcast = vi.fn();
		const h = makeVaultLockHandlers(broadcast);

		expect(h.lock()).toEqual({ locked: true });
		expect(broadcast).toHaveBeenCalledTimes(1);
		expect(broadcast).toHaveBeenLastCalledWith(true);
		expect(h.status()).toEqual({ locked: true });

		// Wrong PIN: no unlock broadcast.
		const wrong = await h.unlock("0000");
		expect(wrong.ok).toBe(false);
		expect(broadcast).toHaveBeenCalledTimes(1);
		expect(h.status()).toEqual({ locked: true });

		// Right PIN: broadcasts locked=false.
		const right = await h.unlock("1234");
		expect(right).toEqual({ ok: true });
		expect(broadcast).toHaveBeenCalledTimes(2);
		expect(broadcast).toHaveBeenLastCalledWith(false);
		expect(h.status()).toEqual({ locked: false });
	});

	it("coerces a non-string PIN arg to an empty string (rejected, no broadcast)", async () => {
		const session = await VaultSession.create({
			vaultId: "vlt_coerce",
			vaultPath: vaultDir,
			forceInsecure: true,
		});
		setActiveVaultSession(session);
		await setAppLockPin(session.backend, "vlt_coerce", "1234");
		const broadcast = vi.fn();
		const h = makeVaultLockHandlers(broadcast);
		h.lock();
		broadcast.mockClear();
		// makeVaultLockHandlers.unlock takes a string; the ipcMain wrapper coerces.
		const res = await h.unlock("");
		expect(res.ok).toBe(false);
		expect(broadcast).not.toHaveBeenCalled();
	});

	it("sets / probes / clears the PIN on the active vault", async () => {
		const session = await VaultSession.create({
			vaultId: "vlt_pin",
			vaultPath: vaultDir,
			forceInsecure: true,
		});
		setActiveVaultSession(session);
		const h = makeVaultLockHandlers(vi.fn());

		expect(await h.hasPin()).toBe(false);
		expect(await h.setPin("123456")).toBe(true);
		expect(await h.hasPin()).toBe(true);
		// A valid PIN now actually unlocks (verifies it was stored, not just flagged).
		h.lock();
		expect((await h.unlock("123456")).ok).toBe(true);
		// clearPin reports it existed, then hasPin is false again.
		expect(await h.clearPin()).toBe(true);
		expect(await h.hasPin()).toBe(false);
	});

	it("rejects a floor-invalid PIN without storing it", async () => {
		const session = await VaultSession.create({
			vaultId: "vlt_pin_floor",
			vaultPath: vaultDir,
			forceInsecure: true,
		});
		setActiveVaultSession(session);
		const h = makeVaultLockHandlers(vi.fn());

		expect(await h.setPin("123")).toBe(false); // too short
		expect(await h.setPin(1234)).toBe(false); // not a string
		expect(await h.setPin("x".repeat(65))).toBe(false); // too long
		expect(await h.hasPin()).toBe(false);
	});

	it("gets / sets the auto-lock interval on the active vault", async () => {
		const session = await VaultSession.create({
			vaultId: "vlt_autolock",
			vaultPath: vaultDir,
			forceInsecure: true,
		});
		setActiveVaultSession(session);
		const h = makeVaultLockHandlers(vi.fn());

		expect(await h.setAutoLock(15)).toBe(true);
		expect(await h.getAutoLock()).toBe(15);
		// Out-of-set value is clamped by the store to the default on read-back.
		expect(await h.setAutoLock(999)).toBe(true);
		expect(await h.getAutoLock()).not.toBe(999);
		// Non-number rejected.
		expect(await h.setAutoLock("15")).toBe(false);
	});

	it("no active session → PIN ops are inert", async () => {
		closeActiveVaultSession();
		const h = makeVaultLockHandlers(vi.fn());
		expect(await h.hasPin()).toBe(false);
		expect(await h.setPin("123456")).toBe(false);
		expect(await h.clearPin()).toBe(false);
	});

	it("fires onLockChange(true) on lock and (false) on successful unlock — for app-window masking", async () => {
		const session = await VaultSession.create({
			vaultId: "vlt_onlock",
			vaultPath: vaultDir,
			forceInsecure: true,
		});
		setActiveVaultSession(session);
		await setAppLockPin(session.backend, "vlt_onlock", "1234");
		const onLockChange = vi.fn();
		const h = makeVaultLockHandlers(vi.fn(), onLockChange);

		h.lock();
		expect(onLockChange).toHaveBeenLastCalledWith(true);

		// Wrong PIN does not reveal the app windows.
		await h.unlock("0000");
		expect(onLockChange).toHaveBeenCalledTimes(1);

		// Correct PIN reveals them.
		await h.unlock("1234");
		expect(onLockChange).toHaveBeenLastCalledWith(false);
		expect(onLockChange).toHaveBeenCalledTimes(2);
	});

	it("does not fire onLockChange on a no-op lock (no active vault)", () => {
		const onLockChange = vi.fn();
		const h = makeVaultLockHandlers(vi.fn(), onLockChange);
		h.lock();
		expect(onLockChange).not.toHaveBeenCalled();
	});

	it("enforces the escalating cooldown main-side (verifier is skipped while cooling down)", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const session = await VaultSession.create({
			vaultId: "vlt_cooldown",
			vaultPath: vaultDir,
			forceInsecure: true,
		});
		setActiveVaultSession(session);
		await setAppLockPin(session.backend, "vlt_cooldown", "1234");
		const h = makeVaultLockHandlers(vi.fn());
		h.lock();

		// Three wrong guesses — the first two earn a 0ms cooldown, the third arms
		// the 5s rung.
		expect((await h.unlock("0000")).ok).toBe(false);
		expect((await h.unlock("0000")).ok).toBe(false);
		const third = await h.unlock("0000");
		expect(third).toMatchObject({ ok: false, failedAttempts: 3, cooldownMs: 5000 });

		// During the cooldown even the CORRECT PIN is rejected — proof the gate
		// short-circuits before the verifier runs and doesn't count the attempt.
		const duringCooldown = await h.unlock("1234");
		expect(duringCooldown).toMatchObject({ ok: false, failedAttempts: 3 });

		// After the rung elapses, the correct PIN unlocks.
		vi.advanceTimersByTime(5000);
		expect((await h.unlock("1234")).ok).toBe(true);
	});
});
