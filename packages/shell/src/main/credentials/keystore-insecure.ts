/**
 * InsecureBackend — DEV / CI ONLY. Plaintext secrets persisted to a JSON
 * file inside the vault. Gated by `BRAINSTORM_DEV_INSECURE_CREDENTIALS=1`
 * or by callers passing `forceInsecure: true` (tests).
 *
 * Per docs/security/29-credentials-storage.md §Fallback chain, this is the
 * "developer mode only — refuse in production, allow only when an explicit
 * env var is set, with a giant red banner".
 *
 * Why file-based and not in-memory: vault open/close cycles need to retrieve
 * the master key after process restart. In-memory wouldn't survive `bun run
 * dev` reloading the main process between iterations.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { base64ToBytes, bytesToBase64 } from "./crypto";
import type { KeystoreAccount, KeystoreBackend } from "./keystore";

export const INSECURE_FILENAME = "insecure-keystore.json";
export const PASSPHRASE_WRAP_FILENAME = "passphrase-wrap.json";

type InsecureFile = {
	v: 1;
	warning: string;
	secrets: Record<string, string>; // base64 keyed by `<vault-id>.<account>`
};

const WARNING_TEXT =
	"⚠️ DEV MODE — Brainstorm credentials are stored UNENCRYPTED in this file. " +
	"Do not use this vault for real data. Delete BRAINSTORM_DEV_INSECURE_CREDENTIALS to switch back to the OS keystore.";

export class InsecureBackend implements KeystoreBackend {
	readonly name = "insecure-dev" as const;
	readonly description = "Plaintext on-disk dev keystore — DO NOT USE FOR REAL DATA";
	readonly isInsecure = true;
	readonly isPersistent = true;

	private readonly filePath: string;

	constructor(vaultPath: string) {
		this.filePath = join(vaultPath, "shell", INSECURE_FILENAME);
	}

	async setSecret(vaultId: string, account: KeystoreAccount, secret: Uint8Array): Promise<void> {
		const file = await this.read();
		file.secrets[`${vaultId}.${account}`] = bytesToBase64(secret);
		await this.write(file);
	}

	async getSecret(vaultId: string, account: KeystoreAccount): Promise<Uint8Array | null> {
		const file = await this.read();
		const encoded = file.secrets[`${vaultId}.${account}`];
		if (!encoded) return null;
		return base64ToBytes(encoded);
	}

	async deleteSecret(vaultId: string, account: KeystoreAccount): Promise<boolean> {
		const file = await this.read();
		const key = `${vaultId}.${account}`;
		if (!(key in file.secrets)) return false;
		delete file.secrets[key];
		await this.write(file);
		return true;
	}

	/** Test helper. Removes the keystore file. */
	async clear(): Promise<void> {
		await rm(this.filePath, { force: true });
	}

	private async read(): Promise<InsecureFile> {
		try {
			const raw = await readFile(this.filePath, "utf8");
			const parsed = JSON.parse(raw) as Partial<InsecureFile>;
			return {
				v: 1,
				warning: WARNING_TEXT,
				secrets:
					parsed && typeof parsed === "object" && parsed.secrets && typeof parsed.secrets === "object"
						? (parsed.secrets as Record<string, string>)
						: {},
			};
		} catch (error) {
			if (isNotFound(error)) {
				return { v: 1, warning: WARNING_TEXT, secrets: {} };
			}
			throw error;
		}
	}

	private async write(file: InsecureFile): Promise<void> {
		await mkdir(dirname(this.filePath), { recursive: true });
		await writeFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
	}
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code: unknown }).code === "ENOENT"
	);
}
