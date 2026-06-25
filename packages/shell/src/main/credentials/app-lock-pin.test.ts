import { describe, expect, it } from "vitest";
import { clearAppLockPin, hasAppLockPin, setAppLockPin, verifyAppLockPin } from "./app-lock-pin";
import type { KeystoreAccount, KeystoreBackend } from "./keystore";

/** In-memory KeystoreBackend for tests — exercises the real Argon2id derive +
 *  blob round-trip without touching the OS keyring. */
function fakeBackend(): KeystoreBackend {
	const store = new Map<string, Uint8Array>();
	const key = (vaultId: string, account: KeystoreAccount) => `${vaultId}:${account}`;
	return {
		name: "insecure-dev",
		description: "fake",
		isInsecure: true,
		isPersistent: false,
		async setSecret(vaultId, account, secret) {
			store.set(key(vaultId, account), secret);
		},
		async getSecret(vaultId, account) {
			return store.get(key(vaultId, account)) ?? null;
		},
		async deleteSecret(vaultId, account) {
			return store.delete(key(vaultId, account));
		},
	};
}

const VAULT = "vault-1";

describe("app-lock PIN verifier", () => {
	it("verifies the correct PIN and rejects a wrong one", async () => {
		const backend = fakeBackend();
		await setAppLockPin(backend, VAULT, "1234");
		expect(await verifyAppLockPin(backend, VAULT, "1234")).toBe(true);
		expect(await verifyAppLockPin(backend, VAULT, "1235")).toBe(false);
		expect(await verifyAppLockPin(backend, VAULT, "")).toBe(false);
	});

	it("reports presence and verifies false before any PIN is set", async () => {
		const backend = fakeBackend();
		expect(await hasAppLockPin(backend, VAULT)).toBe(false);
		expect(await verifyAppLockPin(backend, VAULT, "1234")).toBe(false);
		await setAppLockPin(backend, VAULT, "1234");
		expect(await hasAppLockPin(backend, VAULT)).toBe(true);
	});

	it("re-set replaces the PIN (fresh salt, old PIN stops verifying)", async () => {
		const backend = fakeBackend();
		await setAppLockPin(backend, VAULT, "1234");
		await setAppLockPin(backend, VAULT, "5678");
		expect(await verifyAppLockPin(backend, VAULT, "5678")).toBe(true);
		expect(await verifyAppLockPin(backend, VAULT, "1234")).toBe(false);
	});

	it("uses a fresh salt each time (same PIN → different stored blob)", async () => {
		const backend = fakeBackend();
		await setAppLockPin(backend, VAULT, "1234");
		const first = await backend.getSecret(VAULT, "app-lock-pin");
		await setAppLockPin(backend, VAULT, "1234");
		const second = await backend.getSecret(VAULT, "app-lock-pin");
		expect(first).not.toBeNull();
		expect(new TextDecoder().decode(first as Uint8Array)).not.toBe(
			new TextDecoder().decode(second as Uint8Array),
		);
		// ...but both still verify the same PIN.
		expect(await verifyAppLockPin(backend, VAULT, "1234")).toBe(true);
	});

	it("clear removes the PIN", async () => {
		const backend = fakeBackend();
		await setAppLockPin(backend, VAULT, "1234");
		expect(await clearAppLockPin(backend, VAULT)).toBe(true);
		expect(await hasAppLockPin(backend, VAULT)).toBe(false);
		expect(await verifyAppLockPin(backend, VAULT, "1234")).toBe(false);
		// clearing again is a no-op false.
		expect(await clearAppLockPin(backend, VAULT)).toBe(false);
	});

	it("returns false (no throw) on a malformed stored blob", async () => {
		const backend = fakeBackend();
		await backend.setSecret(VAULT, "app-lock-pin", new TextEncoder().encode("not json"));
		expect(await verifyAppLockPin(backend, VAULT, "1234")).toBe(false);
	});

	it("scopes PINs per vault id", async () => {
		const backend = fakeBackend();
		await setAppLockPin(backend, "vault-a", "1111");
		await setAppLockPin(backend, "vault-b", "2222");
		expect(await verifyAppLockPin(backend, "vault-a", "1111")).toBe(true);
		expect(await verifyAppLockPin(backend, "vault-a", "2222")).toBe(false);
		expect(await verifyAppLockPin(backend, "vault-b", "2222")).toBe(true);
	});
});
