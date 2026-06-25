/**
 * In-memory provider registry — maps provider ids to `ModelProvider`s and
 * resolves the configured default when a request pins none. One instance
 * lives for the shell's lifetime; v1-beta registers a single local Ollama
 * provider, but the shape admits cloud providers behind the same seam
 * (doc 22 — provider routing per user configuration).
 */

import type { ModelProvider } from "./provider";

export class ProviderRegistry {
	private readonly providers = new Map<string, ModelProvider>();
	private defaultId: string | null = null;

	/** Register a provider; the first registered becomes the default
	 *  unless one is set explicitly. */
	register(provider: ModelProvider, opts?: { default?: boolean }): void {
		this.providers.set(provider.id, provider);
		if (opts?.default || this.defaultId === null) this.defaultId = provider.id;
	}

	setDefault(id: string): void {
		if (this.providers.has(id)) this.defaultId = id;
	}

	/** Resolve a provider by id, or the default when `id` is undefined.
	 *  Returns `null` when nothing usable is configured. */
	get(id: string | undefined): ModelProvider | null {
		if (id !== undefined) return this.providers.get(id) ?? null;
		if (this.defaultId === null) return null;
		return this.providers.get(this.defaultId) ?? null;
	}

	has(id: string): boolean {
		return this.providers.has(id);
	}
}
