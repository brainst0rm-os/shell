/**
 * `ydoc-remote-broadcast.ts` — 9.3.2c live cross-window Y.Doc
 * convergence. The 9.3.2b transport gave each renderer a load+persist
 * replica (single-writer-per-entity converges). This adds the inbound
 * leg: when `entities.applyDoc` reaches the canonical doc, the entities
 * service fans the just-applied delta here, and we push it to the
 * *other* app windows holding that entity open so their replica merges
 * without a reload.
 *
 * Unlike `vault-entities-broadcast` (a payload-free "stale" signal,
 * authority re-checked via the broker), this channel necessarily
 * carries the Yjs update bytes — the resolver's `onRemote(apply)`
 * contract is delta-shaped, and re-loading a full snapshot per remote
 * keystroke is a live-editing perf anti-pattern. The security envelope
 * is held at the source instead: the entities service only ever passes
 * `targetApps` that previously `loadDoc`'d the entity (so they already
 * passed the per-type `entities.read` gate and already hold the
 * plaintext replica). Delivery here is a strict subset of that set —
 * no new authorization surface, fail-closed by virtue of an empty
 * target list delivering nothing.
 */

import { type AppWindow, isAppWindowLive } from "../apps/launcher";

/** Must match the `ipcRenderer.on(...)` channel in `app-preload.ts`. */
export const APP_YDOC_REMOTE_CHANNEL = "app:ydoc-remote";

export type YDocRemotePayload = {
	entityId: string;
	/** base64 of the Yjs update bytes (no yjs types cross IPC). */
	updateB64: string;
};

/** Push a canonical-applied delta to exactly the windows of `targetApps`.
 *  Exported so tests can drive it without a vault session or the broker;
 *  mirrors `broadcastVaultEntitiesStaleSignal`'s resilience (skip
 *  destroyed, swallow a single failing send).
 *
 *  9.3.2d — returns the subset of `targetApps` that had **no live
 *  window** (renderer crashed / closed without `closeDoc`). The entities
 *  service prunes those from `docSubscribers` so a dead app's refcount
 *  can't linger for the service lifetime. An app with at least one
 *  non-destroyed window is "live" even if a sibling window died. */
export function deliverYDocUpdateToApps(
	appWindows: readonly AppWindow[],
	entityId: string,
	updateB64: string,
	targetApps: readonly string[],
): readonly string[] {
	if (targetApps.length === 0) return [];
	const targets = new Set(targetApps);
	const liveApps = new Set<string>();
	const payload: YDocRemotePayload = { entityId, updateB64 };
	for (const win of appWindows) {
		if (!targets.has(win.appId)) continue;
		if (!isAppWindowLive(win)) continue;
		liveApps.add(win.appId);
		try {
			win.webContents.send(APP_YDOC_REMOTE_CHANNEL, payload);
		} catch (error) {
			console.warn(`[brainstorm] ydoc-remote push to ${win.appId} failed:`, error);
		}
	}
	return targetApps.filter((a) => !liveApps.has(a));
}
