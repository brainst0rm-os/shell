/**
 * `useIcon` — subscribe a component to the active `IconPack/v1` so it
 * re-renders when a pack is installed/cleared, returning the override
 * glyph markup for `name` (or `null` to fall through to the built-in
 * Phosphor glyph). The reactive counterpart of `resolveIconOverride`;
 * `<Icon>` uses it so a pack swap repaints every icon live.
 */

import { useSyncExternalStore } from "react";
import { getIconPackEpoch, resolveIconOverride, subscribeIconPack } from "./icon-pack-runtime";

export function useIcon(name: string): string | null {
	// Epoch is the snapshot — stable until a pack swap, so the store read
	// is consistent and SSR-safe (same getter both sides).
	useSyncExternalStore(subscribeIconPack, getIconPackEpoch, getIconPackEpoch);
	return resolveIconOverride(name);
}
