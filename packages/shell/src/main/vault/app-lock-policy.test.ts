import { describe, expect, it } from "vitest";
import { APP_LOCK_ATTEMPT_CAP, appLockCooldownMs, isAppLockCapped } from "./app-lock-policy";

describe("app-lock brute-force policy", () => {
	it("gives the first two failures no cooldown, then escalates", () => {
		expect(appLockCooldownMs(0)).toBe(0);
		expect(appLockCooldownMs(1)).toBe(0);
		expect(appLockCooldownMs(2)).toBe(0);
		expect(appLockCooldownMs(3)).toBe(5_000);
		expect(appLockCooldownMs(4)).toBe(15_000);
		expect(appLockCooldownMs(5)).toBe(30_000);
		expect(appLockCooldownMs(6)).toBe(60_000);
	});

	it("clamps to the longest cooldown rung past the ladder", () => {
		expect(appLockCooldownMs(7)).toBe(60_000);
		expect(appLockCooldownMs(99)).toBe(60_000);
	});

	it("treats negative / zero attempts as no cooldown", () => {
		expect(appLockCooldownMs(-1)).toBe(0);
		expect(appLockCooldownMs(0)).toBe(0);
	});

	it("caps the PIN after the attempt cap (passphrase re-auth required)", () => {
		expect(isAppLockCapped(APP_LOCK_ATTEMPT_CAP - 1)).toBe(false);
		expect(isAppLockCapped(APP_LOCK_ATTEMPT_CAP)).toBe(true);
		expect(isAppLockCapped(APP_LOCK_ATTEMPT_CAP + 3)).toBe(true);
		expect(isAppLockCapped(0)).toBe(false);
	});
});
