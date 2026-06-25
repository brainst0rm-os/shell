/**
 * KeyringBackend — wraps `@napi-rs/keyring` for real OS-keystore access.
 *
 * Per :
 *   - macOS:   Keychain Services
 *   - Windows: Credential Manager (DPAPI under the hood)
 *   - Linux:   Secret Service via libsecret (GNOME Keyring / KWallet)
 *
 * All of a vault's secrets live in a SINGLE keystore item, addressed as
 * `(service="brainstorm.<vault-id>", username="brainstorm")`, whose value is a
 * JSON map of `{ <account>: <base64-secret> }`. The OS keystore prompts for
 * access PER ITEM (macOS Keychain especially), so one item per vault means one
 * approval rather than one per secret (identity / master / device keys /
 * app-lock-pin). Earlier builds stored one item per account
 * (`brainstorm.<vault-id>.<account>`); `getSecret` falls back to that legacy
 * layout so vaults provisioned before this change keep opening.
 *
 * Why the `tryCreate()` factory rather than a constructor: the @napi-rs/keyring
 * addon may fail to load (e.g. Linux without libsecret) or to access the
 * keystore (e.g. headless CI). `tryCreate()` validates by writing-then-reading
 * a tiny probe value before returning the backend — if the OS keystore is
 * fully working, we return; otherwise return null and the caller falls back.
 */

import { Entry } from "@napi-rs/keyring";
import type { KeystoreAccount, KeystoreBackend, KeystoreBackendName } from "./keystore";

const SHELL_USERNAME = "brainstorm";

/** The single per-vault keystore item holding every account's secret. */
type SecretBundle = Record<string, string>;

export class KeyringBackend implements KeystoreBackend {
	readonly name: KeystoreBackendName;
	readonly description: string;
	readonly isInsecure = false;
	readonly isPersistent = true;

	private constructor(name: KeystoreBackendName, description: string) {
		this.name = name;
		this.description = description;
	}

	/**
	 * Probe the OS keystore: write a small value to a unique service, read it
	 * back, delete it. If all three succeed, the backend is usable.
	 */
	static tryCreate(): KeyringBackend | null {
		const platformName = detectBackendName();
		const probeService = `brainstorm.probe.${Date.now()}.${Math.random().toString(36).slice(2)}`;
		try {
			const entry = new Entry(probeService, SHELL_USERNAME);
			entry.setSecret(new Uint8Array([1, 2, 3]));
			const round = entry.getSecret();
			if (!round || round.length !== 3) {
				return null;
			}
			entry.deleteCredential();
		} catch {
			return null;
		}
		const description = `${KEYRING_DESCRIPTIONS[platformName]} (via @napi-rs/keyring)`;
		return new KeyringBackend(platformName, description);
	}

	async setSecret(vaultId: string, account: KeystoreAccount, secret: Uint8Array): Promise<void> {
		const bundle = this.readBundle(vaultId);
		bundle[account] = Buffer.from(secret).toString("base64");
		this.writeBundle(vaultId, bundle);
	}

	async getSecret(vaultId: string, account: KeystoreAccount): Promise<Uint8Array | null> {
		const bundle = this.readBundle(vaultId);
		const encoded = bundle[account];
		if (encoded !== undefined) {
			return new Uint8Array(Buffer.from(encoded, "base64"));
		}
		// Back-compat: vaults provisioned before consolidation kept one item
		// per account. Read through to the legacy layout so they keep opening.
		return readLegacySecret(vaultId, account);
	}

	async deleteSecret(vaultId: string, account: KeystoreAccount): Promise<boolean> {
		const bundle = this.readBundle(vaultId);
		const inBundle = account in bundle;
		if (inBundle) {
			delete bundle[account];
			if (Object.keys(bundle).length === 0) {
				deleteEntry(bundleService(vaultId));
			} else {
				this.writeBundle(vaultId, bundle);
			}
		}
		const legacyDeleted = deleteEntry(legacyService(vaultId, account));
		return inBundle || legacyDeleted;
	}

	private readBundle(vaultId: string): SecretBundle {
		const entry = new Entry(bundleService(vaultId), SHELL_USERNAME);
		try {
			const value = entry.getSecret();
			if (!value || value.length === 0) return {};
			return JSON.parse(Buffer.from(value).toString("utf8")) as SecretBundle;
		} catch (error) {
			if (isNoEntryError(error)) return {};
			throw error;
		}
	}

	private writeBundle(vaultId: string, bundle: SecretBundle): void {
		const entry = new Entry(bundleService(vaultId), SHELL_USERNAME);
		entry.setSecret(Buffer.from(JSON.stringify(bundle), "utf8"));
	}
}

/** The single consolidated item holding all of a vault's secrets. */
export function bundleService(vaultId: string): string {
	return `brainstorm.${vaultId}`;
}

/** Pre-consolidation per-account item layout (read-through compatibility). */
export function legacyService(vaultId: string, account: KeystoreAccount): string {
	return `brainstorm.${vaultId}.${account}`;
}

function readLegacySecret(vaultId: string, account: KeystoreAccount): Uint8Array | null {
	const entry = new Entry(legacyService(vaultId, account), SHELL_USERNAME);
	try {
		const value = entry.getSecret();
		if (!value || value.length === 0) return null;
		return new Uint8Array(value);
	} catch (error) {
		if (isNoEntryError(error)) return null;
		throw error;
	}
}

function deleteEntry(service: string): boolean {
	const entry = new Entry(service, SHELL_USERNAME);
	try {
		return entry.deleteCredential();
	} catch (error) {
		if (isNoEntryError(error)) return false;
		throw error;
	}
}

function detectBackendName(): KeystoreBackendName {
	switch (process.platform) {
		case "darwin":
			return "keychain-macos";
		case "win32":
			return "credential-manager-windows";
		default:
			return "secret-service-linux";
	}
}

const KEYRING_DESCRIPTIONS: Record<KeystoreBackendName, string> = {
	"keychain-macos": "macOS Keychain",
	"credential-manager-windows": "Windows Credential Manager",
	"secret-service-linux": "Linux Secret Service",
	passphrase: "Passphrase",
	"insecure-dev": "Insecure",
};

function isNoEntryError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const msg = (error as { message?: unknown }).message;
	return typeof msg === "string" && /no\s*matching|no\s*entry|not\s*found/i.test(msg);
}
