/**
 * React adapter for the 9.4.3 block-renderer registry.
 *
 * Two pieces:
 *   - {@link BlockRendererRegistryProvider} — wraps the app tree in a
 *     context carrying the registry instance. Mounted once at the app
 *     root (e.g. `apps/notes/src/main.tsx`).
 *   - {@link useBlockRenderer} — per-`blockId` resolution hook. Returns
 *     `null` while the (async) lookup is pending, then a
 *     {@link BlockRendererInfo} carrier. Loading is transparent: the
 *     shell-card / fallback branch renders the same UI whether the
 *     resolution has landed or not, so consumers can treat the loading
 *     phase as "use the fallback".
 *
 * Pure render layer: the registry itself stays framework-agnostic
 * ({@link registry.ts}) so the resolver can be exercised under Bun's
 * runtime in vitest without dragging React in.
 */

import { type ReactNode, createContext, useContext, useEffect, useRef, useState } from "react";
import {
	BlockRendererFallbackReason,
	type BlockRendererInfo,
	BlockRendererKind,
	type BlockRendererRegistry,
} from "./registry";

const BlockRendererRegistryContext = createContext<BlockRendererRegistry | null>(null);

/** Wrap the tree in a registry context. Apps construct one registry per
 *  runtime (so the cache lives across renders) and pass it in here. */
export function BlockRendererRegistryProvider({
	registry,
	children,
}: {
	registry: BlockRendererRegistry;
	children: ReactNode;
}) {
	return (
		<BlockRendererRegistryContext.Provider value={registry}>
			{children}
		</BlockRendererRegistryContext.Provider>
	);
}

/** Read-only handle on the active registry, or `null` if no provider is
 *  mounted (tests, preview drops). Consumers must tolerate `null` — the
 *  documented fallback is to render the shell entity-card path. */
export function useBlockRendererRegistry(): BlockRendererRegistry | null {
	return useContext(BlockRendererRegistryContext);
}

/** Resolve `blockId` through the active registry. Returns `null` while
 *  the lookup is in flight; a {@link BlockRendererInfo} once it lands.
 *  Re-resolves when `blockId` changes; the registry's promise cache
 *  ensures repeated renders of the same id are cheap. When no provider
 *  is mounted, returns a static `Fallback{NoProvider}` synchronously —
 *  the visible behaviour matches the "no app registered" steady state,
 *  so test/preview rendering stays simple. */
export function useBlockRenderer(blockId: string): BlockRendererInfo | null {
	const registry = useBlockRendererRegistry();
	const [info, setInfo] = useState<BlockRendererInfo | null>(null);
	// Track the latest in-flight resolve so a fast re-render with a
	// different `blockId` doesn't race a stale resolve into setInfo
	// (which would paint the wrong card briefly).
	const liveId = useRef<string>(blockId);
	liveId.current = blockId;

	useEffect(() => {
		if (!registry) {
			setInfo({
				kind: BlockRendererKind.Fallback,
				blockId,
				reason: BlockRendererFallbackReason.NoProvider,
			});
			return;
		}
		let active = true;
		setInfo(null);
		registry.resolve(blockId).then((resolved) => {
			if (!active) return;
			if (liveId.current !== blockId) return;
			setInfo(resolved);
		});
		return () => {
			active = false;
		};
	}, [registry, blockId]);

	return info;
}
