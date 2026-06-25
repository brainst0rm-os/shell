/**
 * App-lock brute-force policy (Stage 13.8, OQ-184): an attempt counter with an
 * escalating cooldown, and a hard cap after which the only escape is full-
 * passphrase re-auth. Pure — no crypto, no I/O — so the lock state machine and
 * the lock-screen surface share one tested source of truth.
 *
 * A 4–6 digit PIN is ~13–20 bits, so the verifier's job is to make *guessing*
 * slow (and ultimately to force a fallback), not to be a cryptographic barrier
 * — the keystore-held secret is the real protection.
 */

/** Failed attempts past which the PIN is locked out entirely; the user must
 *  re-authenticate with the full vault passphrase (which performs the real
 *  keystore unwrap). */
export const APP_LOCK_ATTEMPT_CAP = 7;

// Cooldown (ms) imposed *before the next attempt* after N consecutive failures.
// The first two failures are free (typo tolerance); then escalate.
const COOLDOWN_LADDER_MS: readonly number[] = [
	0, // 0 failures
	0, // 1
	0, // 2
	5_000, // 3 → 5s
	15_000, // 4 → 15s
	30_000, // 5 → 30s
	60_000, // 6 → 60s
];

/** Cooldown (ms) the user must wait before attempting a PIN after
 *  `failedAttempts` consecutive failures. Clamps to the longest rung; returns 0
 *  for negative/zero. Past the cap, `isAppLockCapped` takes over (PIN disabled). */
export function appLockCooldownMs(failedAttempts: number): number {
	if (failedAttempts <= 0) return 0;
	const idx = Math.min(failedAttempts, COOLDOWN_LADDER_MS.length - 1);
	return COOLDOWN_LADDER_MS[idx] as number;
}

/** Whether the PIN is locked out — `failedAttempts` has reached the cap, so the
 *  PIN entry is disabled and only full-passphrase re-auth unlocks. */
export function isAppLockCapped(failedAttempts: number): boolean {
	return failedAttempts >= APP_LOCK_ATTEMPT_CAP;
}
