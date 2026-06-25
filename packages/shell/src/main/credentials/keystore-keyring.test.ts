import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real `@napi-rs/keyring` native addon can't load under Vitest's Bun ABI
// (see keystore.ts), so back it with an in-memory map keyed by service name.
// `username` is the constant SHELL_USERNAME for everything we own, so keying on
// service alone faithfully models the OS keystore for these tests.
const store = new Map<string, Uint8Array>();

vi.mock("@napi-rs/keyring", () => {
	class Entry {
		constructor(
			private readonly service: string,
			private readonly _user: string,
		) {}
		setSecret(value: Uint8Array): void {
			store.set(this.service, new Uint8Array(value));
		}
		getSecret(): Uint8Array {
			const value = store.get(this.service);
			if (!value) throw new Error("No matching entry found in keychain");
			return value;
		}
		deleteCredential(): boolean {
			return store.delete(this.service);
		}
	}
	return { Entry };
});

import { KeyringBackend, bundleService, legacyService } from "./keystore-keyring";

describe("KeyringBackend — single consolidated item per vault", () => {
	const vault = "vlt_test";

	beforeEach(() => store.clear());
	afterEach(() => store.clear());

	function backend(): KeyringBackend {
		const created = KeyringBackend.tryCreate();
		if (!created) throw new Error("probe failed");
		return created;
	}

	it("round-trips a secret and stores it in ONE keychain item", async () => {
		const kb = backend();
		const master = new Uint8Array([1, 2, 3, 4]);
		await kb.setSecret(vault, "master", master);

		expect(await kb.getSecret(vault, "master")).toEqual(master);
		// One consolidated item, not a per-account item.
		expect(store.has(bundleService(vault))).toBe(true);
		expect(store.has(legacyService(vault, "master"))).toBe(false);
	});

	it("keeps every account in the SAME item (one prompt surface)", async () => {
		const kb = backend();
		await kb.setSecret(vault, "master", new Uint8Array([1]));
		await kb.setSecret(vault, "identity", new Uint8Array([2]));
		await kb.setSecret(vault, "device-x25519", new Uint8Array([3]));

		const vaultItems = [...store.keys()].filter((k) => k.includes(vault));
		expect(vaultItems).toEqual([bundleService(vault)]);
		expect(await kb.getSecret(vault, "identity")).toEqual(new Uint8Array([2]));
		expect(await kb.getSecret(vault, "device-x25519")).toEqual(new Uint8Array([3]));
	});

	it("returns null for an unknown account", async () => {
		const kb = backend();
		await kb.setSecret(vault, "master", new Uint8Array([1]));
		expect(await kb.getSecret(vault, "recovery")).toBeNull();
	});

	it("reads through to the legacy per-account layout", async () => {
		const kb = backend();
		// Simulate a vault provisioned before consolidation.
		store.set(legacyService(vault, "identity"), new Uint8Array([9, 9]));
		expect(await kb.getSecret(vault, "identity")).toEqual(new Uint8Array([9, 9]));
	});

	it("deletes from both the bundle and the legacy item", async () => {
		const kb = backend();
		await kb.setSecret(vault, "master", new Uint8Array([1]));
		store.set(legacyService(vault, "master"), new Uint8Array([1]));

		expect(await kb.deleteSecret(vault, "master")).toBe(true);
		expect(await kb.getSecret(vault, "master")).toBeNull();
		expect(store.has(legacyService(vault, "master"))).toBe(false);
	});

	it("removes the consolidated item once its last account is deleted", async () => {
		const kb = backend();
		await kb.setSecret(vault, "master", new Uint8Array([1]));
		await kb.deleteSecret(vault, "master");
		expect(store.has(bundleService(vault))).toBe(false);
	});
});
