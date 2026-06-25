/**
 * Keystore backend abstraction per docs/security/29-credentials-storage.md.
 *
 * Tier 1 storage — the small set of secrets we keep in the OS-protected
 * keystore (identity private key, vault master key, optional recovery key).
 * Three concrete backends:
 *
 *   - KeyringBackend     — real OS keystore via `@napi-rs/keyring`
 *                          (macOS Keychain / Windows Credential Manager /
 *                          Linux Secret Service). Production path.
 *   - PassphraseBackend  — fallback when no OS keystore exists. The vault
 *                          master key is wrapped under an Argon2id-derived
 *                          key from a user-supplied passphrase.
 *   - InsecureBackend    — dev-mode only. Plaintext JSON file inside the
 *                          vault. Gated by BRAINSTORM_DEV_INSECURE_CREDENTIALS.
 *
 * The backend is picked at vault-open time and recorded in `vault.json`
 * (`credentialsBackend` field) so the shell tells the user clearly which
 * tier their secrets are protected by.
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { InsecureBackend, PASSPHRASE_WRAP_FILENAME } from "./keystore-insecure";
import { PassphraseBackend, type PassphraseSecrets } from "./keystore-passphrase";

export type KeystoreBackendName =
	| "keychain-macos"
	| "credential-manager-windows"
	| "secret-service-linux"
	| "passphrase"
	| "insecure-dev";

export const KEYSTORE_BACKEND_DISPLAY: Record<KeystoreBackendName, string> = {
	"keychain-macos": "macOS Keychain",
	"credential-manager-windows": "Windows Credential Manager",
	"secret-service-linux": "Linux Secret Service",
	passphrase: "Passphrase",
	"insecure-dev": "Insecure (dev mode)",
};

/** Accounts the shell stores. Stage 2 introduced identity + master; Stage
 *  10.2 added `device-x25519` (recipient half of HPKE member wraps; see
 *  `device-x25519.ts`); Stage 10.5a added `device-ed25519` (per-device
 *  signing key used by the pairing handshake; see `device-ed25519.ts`).
 *  `recovery` is reserved for the recovery key flow (out of v1 scope,
 *  surfaces at Stage 10.5 pairing UX). */
export type KeystoreAccount =
	| "identity"
	| "master"
	| "device-x25519"
	| "device-ed25519"
	| "recovery"
	// App-lock PIN verifier (light-Argon2id hash blob). Readable while the
	// master key is zeroed — the PIN gates getting the key back (Stage 13.8).
	| "app-lock-pin";

export interface KeystoreBackend {
	readonly name: KeystoreBackendName;
	readonly description: string;

	/** Whether the backend keeps secrets plaintext on disk (UI hint). */
	readonly isInsecure: boolean;

	/** Whether secrets survive across shell restarts (true for all real backends). */
	readonly isPersistent: boolean;

	setSecret(vaultId: string, account: KeystoreAccount, secret: Uint8Array): Promise<void>;
	getSecret(vaultId: string, account: KeystoreAccount): Promise<Uint8Array | null>;
	deleteSecret(vaultId: string, account: KeystoreAccount): Promise<boolean>;
}

export type PickKeystoreOptions = {
	vaultPath: string;
	/** For tests / dev — force insecure even without the env var. */
	forceInsecure?: boolean;
	/**
	 * Skip the keyring probe entirely. Used by tests to exercise the fallback
	 * chain on platforms where the OS keystore *would* succeed otherwise.
	 * Future: when a vault is configured to prefer passphrase over keyring,
	 * the open path sets this.
	 */
	skipKeyring?: boolean;
	/** Passphrase to unlock an existing passphrase-wrapped vault (or set up a new one). */
	passphrase?: PassphraseSecrets;
};

export function isInsecureModeEnabled(): boolean {
	return process.env.BRAINSTORM_DEV_INSECURE_CREDENTIALS === "1";
}

/**
 * Pick the highest-trust backend that's available for this vault. The choice
 * is sticky per vault — once a vault was created under (say) the OS keyring,
 * opening it elsewhere with only passphrase available is a recovery scenario,
 * not a routine vault-open.
 */
export async function pickKeystore(options: PickKeystoreOptions): Promise<KeystoreBackend> {
	if (options.forceInsecure || isInsecureModeEnabled()) {
		return new InsecureBackend(options.vaultPath);
	}

	if (!options.skipKeyring) {
		const keyring = await tryLoadKeyringBackend();
		if (keyring) return keyring;
	}

	const wrapPath = join(options.vaultPath, "shell", PASSPHRASE_WRAP_FILENAME);
	const wrapExists = await fileExists(wrapPath);
	if (wrapExists || options.passphrase) {
		if (!options.passphrase) {
			throw new Error(
				"No OS keystore available and this vault uses a passphrase. Provide options.passphrase to unlock.",
			);
		}
		return await PassphraseBackend.openOrCreate(options.vaultPath, options.passphrase);
	}

	throw new Error(
		"No OS keystore is available. Configure a passphrase, or run with BRAINSTORM_DEV_INSECURE_CREDENTIALS=1 for development.",
	);
}

async function tryLoadKeyringBackend(): Promise<KeystoreBackend | null> {
	try {
		// Lazy import: Vitest runs under Bun's ABI and would mis-load the
		// native addon. Production runs under Electron's Node ABI where the
		// addon's prebuilt binary matches.
		const mod = await import("./keystore-keyring");
		return mod.KeyringBackend.tryCreate();
	} catch (error) {
		console.warn("[brainstorm] keyring backend unavailable:", error);
		return null;
	}
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}
