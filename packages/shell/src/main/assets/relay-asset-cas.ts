/**
 * Asset-B4 — bind the Asset-B2 `WireAssetCas` to the live relay's asset channel.
 *
 * The asset transport (`uploadAsset` / `downloadAsset`) talks to an abstract
 * `AssetCas`; on a real device that CAS is the durable node, reached over the
 * relay's `requestAsset` (the Asset-B4-foundation channel `0x02`). This is the
 * one-line adapter that closes that gap.
 *
 * Returns null when the surface has no asset transport — a loopback relay (no
 * durable node) or a node that doesn't speak the blob plane — so callers treat
 * "no CAS" as "can't sync this asset yet", not an error.
 */

import type { RelaySurface } from "../sync/relay-port";
import type { AssetCas } from "./asset-cas";
import { WireAssetCas } from "./asset-wire";

export function relayAssetCas(surface: RelaySurface): AssetCas | null {
	const requestAsset = surface.requestAsset?.bind(surface);
	if (!requestAsset) return null;
	return new WireAssetCas((frame) => requestAsset(frame));
}
