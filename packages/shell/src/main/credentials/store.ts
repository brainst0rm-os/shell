/**
 * Tier 2 credential store per docs/security/29-credentials-storage.md.
 *
 *   Tier 1 = OS-keystore items (identity + master key + optional recovery).
 *   Tier 2 = bulk app-private secrets encrypted under the vault master key.
 *
 * Stage 2 implementation: a single encrypted JSON file at
 * `<vault>/shell/credentials.json`. Each value is XChaCha20-Poly1305
 * ciphertext under the vault master key (one nonce per value, fresh per write).
 *
 * Per-app keyspace isolation: every entry is namespaced
 * `(app: string, key: string)`. The shell registers its own entries under
 * `app="shell"`. Apps cannot read each other's keys — the broker enforces
 * that in Stage 4; the store contract just takes (app, key) and trusts
 * the caller to have passed the right `app`.
 *
 * OQ-34 deferral note: we do NOT use SQLite here. A flat encrypted JSON file
 * is enough for the scale of secrets a single user has (tens to hundreds).
 * Migration to a SQLite-backed table can happen later without changing the
 * external API.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	type SealedSecret,
	XCHACHA_KEY_BYTES,
	isSealedSecret,
	openSecret,
	sealSecret,
} from "./crypto";

export const CREDENTIALS_FILENAME = "credentials.json";

/** Hard cap per OQ-116 (tentative): 64 KiB per value. */
export const MAX_VALUE_BYTES = 64 * 1024;

export type CredentialKey = {
	app: string;
	key: string;
};

type StoreFile = {
	v: 1;
	entries: Record<string, StoreEntry>;
};

type StoreEntry = {
	app: string;
	key: string;
	sealed: SealedSecret;
	createdAt: number;
	updatedAt: number;
};

export type CredentialMetadata = {
	app: string;
	key: string;
	createdAt: number;
	updatedAt: number;
};

export class CredentialStore {
	private readonly filePath: string;
	private readonly masterKey: Uint8Array;

	constructor(vaultPath: string, masterKey: Uint8Array) {
		if (masterKey.length !== XCHACHA_KEY_BYTES) {
			throw new Error(`CredentialStore: master key must be ${XCHACHA_KEY_BYTES} bytes`);
		}
		this.filePath = join(vaultPath, "shell", CREDENTIALS_FILENAME);
		this.masterKey = masterKey;
	}

	async set(target: CredentialKey, value: Uint8Array): Promise<void> {
		assertCredentialKey(target);
		if (value.length > MAX_VALUE_BYTES) {
			throw new Error(
				`CredentialStore: value too large (${value.length} bytes); max ${MAX_VALUE_BYTES}`,
			);
		}
		const file = await this.read();
		const id = entryId(target);
		const now = Date.now();
		const sealed = sealSecret(this.masterKey, value, this.aadFor(target));
		const existing = file.entries[id];
		file.entries[id] = {
			app: target.app,
			key: target.key,
			sealed,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		};
		await this.write(file);
	}

	async get(target: CredentialKey): Promise<Uint8Array | null> {
		assertCredentialKey(target);
		const file = await this.read();
		const entry = file.entries[entryId(target)];
		if (!entry) return null;
		try {
			return openSecret(this.masterKey, entry.sealed, this.aadFor(target));
		} catch (error) {
			throw new Error(
				`CredentialStore: failed to decrypt ${target.app}/${target.key}: ${(error as Error).message}`,
			);
		}
	}

	async delete(target: CredentialKey): Promise<boolean> {
		assertCredentialKey(target);
		const file = await this.read();
		const id = entryId(target);
		if (!(id in file.entries)) return false;
		delete file.entries[id];
		await this.write(file);
		return true;
	}

	/**
	 * List metadata for entries belonging to an app. Returns keys + timestamps,
	 * never plaintext values. Apps use this to enumerate their own keyspace.
	 */
	async list(app: string): Promise<CredentialMetadata[]> {
		assertApp(app);
		const file = await this.read();
		const out: CredentialMetadata[] = [];
		for (const entry of Object.values(file.entries)) {
			if (entry.app === app) {
				out.push({
					app: entry.app,
					key: entry.key,
					createdAt: entry.createdAt,
					updatedAt: entry.updatedAt,
				});
			}
		}
		out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
		return out;
	}

	/** Drop the file entirely. Used by uninstall flows and tests. */
	async clear(): Promise<void> {
		await rm(this.filePath, { force: true });
	}

	/** Bind every ciphertext to its (app, key) — same plaintext under a different
	 *  (app, key) won't decrypt. Defense in depth against entry-id mismatches. */
	private aadFor(target: CredentialKey): Uint8Array {
		return new TextEncoder().encode(`brainstorm/credential/${target.app}/${target.key}`);
	}

	private async read(): Promise<StoreFile> {
		try {
			const raw = await readFile(this.filePath, "utf8");
			const parsed = JSON.parse(raw) as Partial<StoreFile>;
			if (parsed && parsed.v === 1 && parsed.entries && typeof parsed.entries === "object") {
				const cleaned: Record<string, StoreEntry> = {};
				for (const [id, entry] of Object.entries(parsed.entries)) {
					if (isStoreEntry(entry)) cleaned[id] = entry;
				}
				return { v: 1, entries: cleaned };
			}
			return { v: 1, entries: {} };
		} catch (error) {
			if (isNotFound(error)) {
				return { v: 1, entries: {} };
			}
			throw error;
		}
	}

	private async write(file: StoreFile): Promise<void> {
		await mkdir(dirname(this.filePath), { recursive: true });
		await writeFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
	}
}

function entryId(target: CredentialKey): string {
	return `${target.app}::${target.key}`;
}

const APP_PATTERN = /^[A-Za-z0-9._-]{1,256}$/;
const KEY_PATTERN = /^[A-Za-z0-9._:/-]{1,256}$/;

function assertCredentialKey(target: CredentialKey): void {
	assertApp(target.app);
	if (typeof target.key !== "string" || !KEY_PATTERN.test(target.key)) {
		throw new Error(`CredentialStore: invalid key: ${JSON.stringify(target.key)}`);
	}
}

function assertApp(app: string): void {
	if (typeof app !== "string" || !APP_PATTERN.test(app)) {
		throw new Error(`CredentialStore: invalid app id: ${JSON.stringify(app)}`);
	}
}

function isStoreEntry(value: unknown): value is StoreEntry {
	if (!value || typeof value !== "object") return false;
	const e = value as Partial<StoreEntry>;
	return (
		typeof e.app === "string" &&
		typeof e.key === "string" &&
		typeof e.createdAt === "number" &&
		typeof e.updatedAt === "number" &&
		isSealedSecret(e.sealed)
	);
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code: unknown }).code === "ENOENT"
	);
}
