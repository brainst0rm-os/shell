/**
 * The local author identity — who "you" are in a channel. A Chat message's
 * author travels ON the message (the `participant` sender's `personRef` +
 * `displayName`), so it survives sync to everyone else's device. This module
 * owns the per-device pref backing that: a stable `personRef` minted once and a
 * `displayName` the user can edit.
 *
 * Stored via the app-private `storage.kv` service (NOT localStorage — that's
 * per-origin, and the shared substrate wants a vault-scoped, app-scoped home).
 * The async load/save take a structurally-typed store so they unit-test against
 * a fake; the sanitiser + default are pure.
 */

export const DISPLAY_NAME_KEY = "chat:display-name";
export const PERSON_REF_KEY = "chat:person-ref";

export const DISPLAY_NAME_MAX = 40;

export type LocalIdentity = {
	personRef: string;
	displayName: string;
	/** Serialized universal `Icon` the user set as their avatar (signed onto their
	 *  `Profile/v1`), if any — carried so editing the name in Chat preserves it. */
	avatarRef?: string;
};

/** The structural slice of `StorageService` this module needs — so the loader
 *  tests against a `Map`-backed fake without the whole SDK surface. */
export type KvStore = {
	get<T = unknown>(key: string): Promise<T | null>;
	put(key: string, value: unknown): Promise<void>;
};

/** Trim, collapse inner whitespace, strip C0/C1/DEL control chars, clamp to the
 *  max. An empty/garbage name normalises to "" so the caller falls back to the
 *  default. Codepoint filter (not a control-char regex literal) keeps biome's
 *  `noControlCharactersInRegex` happy without a suppression. */
export function sanitizeDisplayName(raw: string): string {
	let out = "";
	for (const ch of raw) {
		const code = ch.codePointAt(0) ?? 0;
		out += code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? " " : ch;
	}
	return out.replace(/\s+/g, " ").trim().slice(0, DISPLAY_NAME_MAX);
}

/** A short, stable, non-secret author key. Not crypto identity — just a
 *  consistent grouping/colour key for this device's posts (the durable identity
 *  is the vault's, layered on when Chat goes multi-user for real). The `seed`
 *  makes it deterministic in tests; production passes a time+random seed. */
export function mintPersonRef(seed: string): string {
	let hash = 0;
	for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
	return `chat-person-${(hash >>> 0).toString(36)}`;
}

/** Load the local identity, minting + persisting a `personRef` on first run.
 *  `seed`/`fallbackName` are injected so this is deterministic under test. */
export async function loadIdentity(
	store: KvStore,
	opts: { seed: string; fallbackName: string },
): Promise<LocalIdentity> {
	let personRef = (await store.get<string>(PERSON_REF_KEY)) ?? "";
	if (!personRef) {
		personRef = mintPersonRef(opts.seed);
		await store.put(PERSON_REF_KEY, personRef);
	}
	const stored = sanitizeDisplayName((await store.get<string>(DISPLAY_NAME_KEY)) ?? "");
	return { personRef, displayName: stored || opts.fallbackName };
}

/** Persist an edited display name; returns the sanitised value actually stored.
 *  A name that sanitises to empty is rejected (returns null, no write). */
export async function saveDisplayName(store: KvStore, raw: string): Promise<string | null> {
	const name = sanitizeDisplayName(raw);
	if (!name) return null;
	await store.put(DISPLAY_NAME_KEY, name);
	return name;
}
