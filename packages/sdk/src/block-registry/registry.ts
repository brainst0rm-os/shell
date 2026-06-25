/**
 * Block-renderer registry (Stage 9.4.3) — the bridge layer between a
 * `BlockEmbedNode { blockId }` reference and the runtime that paints it.
 *
 * Per OQ-12(a), there are two registries — NOT one — and `BlockEmbedNode`
 * is the bridge:
 *
 *   - **Custom-node registry** (in-process). Renderers that mount as a
 *     Lexical decorator (or any host-side React subtree) and never cross
 *     a frame. The shell's fallback entity-card lives here: it's always
 *     registered, so a freshly-imported document with foreign `blockId`s
 *     still paints a recognisable card without any provider installed.
 *   - **BP-block registry** (out-of-process). App-contributed Block
 *     Protocol blocks that mount in a sandboxed iframe (Stage 9.5
 *     `block-frame` primitive, wired through the 9.4.4 inline-mount seam
 *     in 9.11). Resolution is delegated to a caller-supplied `bpResolver`
 *     — in production that calls `services.blocks.resolve` via the
 *     broker; in tests it's a stub.
 *
 * The lookup order is **custom-node → BP → fallback**. The custom-node
 * registry wins by design (the shell-owned entity-card outranks an
 * app-provided block of the same id), and an unknown id resolves to
 * `{kind: Fallback, reason: NoProvider}` — never throws.
 *
 * Resolutions are promise-cached per blockId so a document with twenty
 * embeds of the same id triggers one broker round-trip, not twenty. The
 * cache is per-registry instance (no global state) and cleared by
 * `invalidate(blockId)` / `clear()` for the rare cases where a provider
 * install changes the answer mid-session (Stage 9.5 dynamic-install).
 *
 * Pure-data API — no React, no Lexical, no DOM. Consumers wrap with
 * their own hook ({@link block-registry-react.tsx}). Tests run under
 * Bun's runtime with no jsdom needed.
 */

/** Renderer category for a resolved blockId. */
export const BlockRendererKind = {
	/** In-process Lexical decorator / React subtree. The shell entity-card
	 *  fallback is the always-registered example. */
	CustomNode: "custom-node",
	/** Sandboxed-iframe Block Protocol block, provider app registered via
	 *  manifest → `registry.db.blocks`. The 9.4.4 mount seam consumes
	 *  this branch; 9.4.3 only resolves. */
	BlockProtocol: "block-protocol",
	/** Nothing registered for this id. Renderers should paint the
	 *  shell-provided fallback card; never throw. */
	Fallback: "fallback",
} as const;
export type BlockRendererKind = (typeof BlockRendererKind)[keyof typeof BlockRendererKind];

/** Why a resolution landed on `Fallback`. Surfaced so the renderer can
 *  show a subtle hint ("no provider installed" vs. "block id invalid"
 *  vs. "registry temporarily unavailable") and so test assertions can
 *  pin the precise failure mode. */
export const BlockRendererFallbackReason = {
	/** Grammar-valid id, but no custom-node or BP provider answers. */
	NoProvider: "no-provider",
	/** Id failed the `<app-id>/<block-name>` grammar check — never
	 *  reaches either store. Empty string included. */
	Invalid: "invalid",
	/** The BP resolver threw / Unavailable. Distinct from `NoProvider`
	 *  so a transient broker failure can be retried (a future iteration
	 *  may add explicit retry; today we surface the kind and move on). */
	ResolveError: "resolve-error",
} as const;
export type BlockRendererFallbackReason =
	(typeof BlockRendererFallbackReason)[keyof typeof BlockRendererFallbackReason];

/** A custom-node match: the consumer's render layer already knows how
 *  to paint this `blockId` in-process. No appId because the renderer is
 *  host-owned, not app-contributed. */
export type CustomNodeRenderer = {
	readonly kind: typeof BlockRendererKind.CustomNode;
	readonly blockId: string;
};

/** A BP-block match: an app's iframe renders this block. The mount seam
 *  (9.4.4) takes `{blockId, appId, name}` + the embedding entity context
 *  and produces a live frame. */
export type BlockProtocolProvider = {
	readonly kind: typeof BlockRendererKind.BlockProtocol;
	readonly blockId: string;
	readonly appId: string;
	readonly name: string;
};

/** Nothing matched. Renderers fall back to the shell entity-card. */
export type FallbackRenderer = {
	readonly kind: typeof BlockRendererKind.Fallback;
	readonly blockId: string;
	readonly reason: BlockRendererFallbackReason;
};

/** Tagged union the registry returns. Carriers always include `blockId`
 *  so consumers can pass the result straight to the mount seam without
 *  threading the original id separately. */
export type BlockRendererInfo = CustomNodeRenderer | BlockProtocolProvider | FallbackRenderer;

/** Async resolver for BP-block provider lookup. In production this
 *  wraps `bridge.blocks.resolve(blockId)` (`services.blocks.resolve`
 *  via the broker, capability-gated by `blocks.read`). Returns `null`
 *  when no provider is installed; throws when the bridge is unavailable
 *  (no vault session, IPC error). Throws are caught by the registry
 *  and surface as `{kind: Fallback, reason: ResolveError}` — the BP
 *  registry side never propagates exceptions to the renderer. */
export type BpResolver = (blockId: string) => Promise<{ appId: string; name: string } | null>;

/** Public surface of a registry instance. */
export type BlockRendererRegistry = {
	/** Mark `blockId` as having an in-process renderer. Idempotent; a
	 *  second call with the same id is a no-op. Bumps the per-id cache
	 *  so a subsequent `resolve` reflects the new state. */
	registerCustomNode(blockId: string): void;
	/** Remove a previous custom-node registration. Bumps the per-id
	 *  cache so the next `resolve` re-runs the lookup. */
	unregisterCustomNode(blockId: string): void;
	/** Sync probe — does the custom-node side know this id? Useful for
	 *  the renderer to short-circuit straight to the in-process path
	 *  without paying the resolve round-trip when nothing else is in
	 *  question. */
	hasCustomNode(blockId: string): boolean;
	/** Resolve `blockId` to a render path. Custom-node first, then BP,
	 *  then fallback. Always resolves (never rejects) — every error
	 *  surfaces as a {@link FallbackRenderer}. Result is cached per id;
	 *  call {@link invalidate} to force a re-lookup. */
	resolve(blockId: string): Promise<BlockRendererInfo>;
	/** Drop the cache entry for one id. Useful when a provider install
	 *  is known to have changed the answer. */
	invalidate(blockId: string): void;
	/** Drop the entire cache. Cheap; the next `resolve` rebuilds. */
	clear(): void;
};

/** `<app-id>/<block-name>` grammar — must stay in sync with the canonical
 *  `packages/shell/src/main/apps/block-id.ts`. SDK is a leaf package and
 *  can't import shell internals, so the regex is duplicated here with a
 *  named constant and a test that pins exact-equality with the shell
 *  side (see `registry.test.ts`). The validator side strips invalid ids
 *  before they hit the BP resolver — the broker would reject them with
 *  `Invalid` anyway, but failing locally avoids a wasted round-trip. */
export const SDK_BLOCK_ID_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/** True iff `id` is structurally a valid block id. */
export function isStructurallyValidBlockId(id: string): boolean {
	return typeof id === "string" && SDK_BLOCK_ID_PATTERN.test(id);
}

/** Construct a registry instance. Pass `bpResolver` (production: the
 *  bridge-wrapped `services.blocks.resolve`; tests: a stub). Pass
 *  `builtInCustomNodes` to pre-register ids known at construction time
 *  — the shell entity-card fallback is the canonical example. */
export function createBlockRendererRegistry(options: {
	readonly bpResolver?: BpResolver;
	readonly builtInCustomNodes?: readonly string[];
}): BlockRendererRegistry {
	const customNodes = new Set<string>();
	if (options.builtInCustomNodes) {
		for (const id of options.builtInCustomNodes) customNodes.add(id);
	}
	const cache = new Map<string, Promise<BlockRendererInfo>>();
	const { bpResolver } = options;

	const lookup = async (blockId: string): Promise<BlockRendererInfo> => {
		// Custom-node first by design: the shell entity-card constant
		// (`io.brainstorm.shell/entity-card/v1`) is intentionally NOT a
		// grammar-conformant block id (two slashes — the canonical grammar
		// is single-slash `<app-id>/<block-name>`), so a grammar check
		// before this branch would demote it to `Fallback{Invalid}`. The
		// shell-card is registered as a custom-node by every caller via
		// {@link DEFAULT_BUILTIN_CUSTOM_NODES} and short-circuits here.
		if (customNodes.has(blockId)) {
			return { kind: BlockRendererKind.CustomNode, blockId };
		}
		// Grammar check gates BP resolution only — an ill-formed id never
		// reaches the broker; the BP resolver would reject it with `Invalid`
		// anyway, but failing locally avoids a wasted round-trip.
		if (!isStructurallyValidBlockId(blockId)) {
			return {
				kind: BlockRendererKind.Fallback,
				blockId,
				reason: BlockRendererFallbackReason.Invalid,
			};
		}
		if (!bpResolver) {
			return {
				kind: BlockRendererKind.Fallback,
				blockId,
				reason: BlockRendererFallbackReason.NoProvider,
			};
		}
		try {
			const provider = await bpResolver(blockId);
			if (!provider) {
				return {
					kind: BlockRendererKind.Fallback,
					blockId,
					reason: BlockRendererFallbackReason.NoProvider,
				};
			}
			return {
				kind: BlockRendererKind.BlockProtocol,
				blockId,
				appId: provider.appId,
				name: provider.name,
			};
		} catch {
			return {
				kind: BlockRendererKind.Fallback,
				blockId,
				reason: BlockRendererFallbackReason.ResolveError,
			};
		}
	};

	return {
		registerCustomNode(blockId: string) {
			customNodes.add(blockId);
			cache.delete(blockId);
		},
		unregisterCustomNode(blockId: string) {
			customNodes.delete(blockId);
			cache.delete(blockId);
		},
		hasCustomNode(blockId: string): boolean {
			return customNodes.has(blockId);
		},
		resolve(blockId: string): Promise<BlockRendererInfo> {
			const cached = cache.get(blockId);
			if (cached) return cached;
			const promise = lookup(blockId);
			cache.set(blockId, promise);
			return promise;
		},
		invalidate(blockId: string) {
			cache.delete(blockId);
		},
		clear() {
			cache.clear();
		},
	};
}
