/**
 * BYO AI-provider API keys as Tier-2 shell credentials (11.6).
 *
 * Cloud AI providers (Anthropic, …) need an API key. Per doc 22 §Architecture
 * and the credential-routing rule (CLAUDE.md — "the same shape applies to AI
 * provider keys in Stage 11"), the key is owned by the shell: stored in the
 * per-vault `CredentialStore` (sealed under the vault master key, encrypted at
 * rest), read only by the main-process provider at request time, and **never
 * crossing IPC to a sandboxed app** — apps call `ai.generate`/`transform`/…
 * and the broker routes to a provider; the raw key stays here.
 *
 * Keyed per provider id so multiple providers coexist. The value is the raw
 * key string (UTF-8). This module is the one place that names the credential
 * key; the AI wiring + the Settings AI panel (11.9) go through these helpers.
 */

import type { CredentialKey, CredentialStore } from "./store";

/** The credential `app` namespace for shell-owned AI provider keys. */
const AI_PROVIDER_APP = "io.brainstorm.ai";

/** The `CredentialStore` key for a given provider's API key. */
export function aiProviderCredentialKey(providerId: string): CredentialKey {
	return { app: AI_PROVIDER_APP, key: `provider-key:${providerId}` };
}

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

/** Read a provider's stored API key, or `null` when none is configured. */
export async function readAiProviderKey(
	store: CredentialStore,
	providerId: string,
): Promise<string | null> {
	const bytes = await store.get(aiProviderCredentialKey(providerId));
	if (!bytes) return null;
	const key = DECODER.decode(bytes).trim();
	return key.length > 0 ? key : null;
}

/** Store (or replace) a provider's API key. Used by the Settings AI panel
 *  (11.9) and tests; the value is sealed at rest by the `CredentialStore`. */
export async function writeAiProviderKey(
	store: CredentialStore,
	providerId: string,
	apiKey: string,
): Promise<void> {
	await store.set(aiProviderCredentialKey(providerId), ENCODER.encode(apiKey));
}

/** Remove a provider's stored API key. Returns false when none was set. */
export async function deleteAiProviderKey(
	store: CredentialStore,
	providerId: string,
): Promise<boolean> {
	return store.delete(aiProviderCredentialKey(providerId));
}
