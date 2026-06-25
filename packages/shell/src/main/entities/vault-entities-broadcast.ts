/**
 * Vault-entities cross-renderer staleness signal — mirrors the VP-6
 * `app:properties-changed` pattern for the preview vault-entities
 * surface (Stage 9.13.1.8). Whenever a note write reaches the storage
 * worker, the shell pushes `app:vault-entities-changed` to every live
 * app window so the Graph + Database surfaces can re-`list()` and
 * re-render mention/link edges without polling.
 *
 * Payload-free on purpose: the authoritative snapshot must flow back
 * through the broker (`vault-entities.list`) so the capability check
 * re-runs. This channel only carries authority to mean "your snapshot
 * is stale".
 *
 * Replaced (not extended) when the real entities service lands at
 * Stage 9.3 — the channel name stays for back-compat, but the trigger
 * surface widens beyond Notes-only writes.
 */

import type { Envelope } from "../../ipc/envelope";
import { type AppWindow, isAppWindowLive } from "../apps/launcher";

export const APP_VAULT_ENTITIES_CHANGED_CHANNEL = "app:vault-entities-changed";

const NOTES_APP_ID = "io.brainstorm.notes";
const NOTE_KEY_PREFIX = "note:";

const TASKS_APP_ID = "io.brainstorm.tasks";
const TASK_KEY_PREFIX = "task:";
const PROJECT_KEY_PREFIX = "project:";

const SELF_HOSTING_APP_ID = "io.brainstorm.self-hosting";
const SELF_HOSTING_KEY_PREFIXES = [
	"iteration:",
	"open-question:",
	"stage:",
	"design-doc:",
] as const;

/** Pure predicate — does this storage envelope mutate a vault-entity
 *  record we expose through `vault-entities.list`? Used to gate the
 *  broadcast so unrelated writes (an app's settings keys, ad-hoc kv
 *  rows) don't fire a graph re-render.
 *
 *  Recognised shapes:
 *   - Notes app writing a `note:*` key
 *   - Tasks app writing a `task:*` or `project:*` key
 *   - Self-hosting app writing an `iteration:*` / `open-question:*` /
 *     `stage:*` / `design-doc:*` key
 *
 *  As the aggregator in `vault-entities-service` grows, add the new
 *  (app, prefix) pair here too — the two files share one protocol. */
export function isVaultEntityWriteEnvelope(envelope: Envelope): boolean {
	if (envelope.service !== "storage") return false;
	if (envelope.method !== "put" && envelope.method !== "delete") return false;
	const arg = envelope.args[0] as { key?: unknown } | undefined;
	if (!arg || typeof arg.key !== "string") return false;
	const key = arg.key;
	if (envelope.app === NOTES_APP_ID) return key.startsWith(NOTE_KEY_PREFIX);
	if (envelope.app === TASKS_APP_ID) {
		return key.startsWith(TASK_KEY_PREFIX) || key.startsWith(PROJECT_KEY_PREFIX);
	}
	if (envelope.app === SELF_HOSTING_APP_ID) {
		return SELF_HOSTING_KEY_PREFIXES.some((p) => key.startsWith(p));
	}
	return false;
}

/** A non-app-window target that also wants the staleness signal — the dashboard
 *  window, so its widget iframes (which have no own webContents) can re-list.
 *  Registered once at startup via `setVaultEntitiesStaleExtraTarget`. */
type StaleSignalTarget = { webContents: { isDestroyed(): boolean; send(channel: string): void } };
let getExtraTarget: (() => StaleSignalTarget | null) | null = null;

/** Register an extra target (the dashboard window) for the staleness signal, so
 *  every existing broadcast call site also notifies it without threading it
 *  through. */
export function setVaultEntitiesStaleExtraTarget(
	getter: (() => StaleSignalTarget | null) | null,
): void {
	getExtraTarget = getter;
}

/** Push the bare staleness signal to every live app window (+ the registered
 *  extra target, e.g. the dashboard window). Exported so tests can exercise the
 *  broadcast without spinning up a vault session or the broker. Mirrors
 *  `broadcastStaleSignalToAppWindows` in `properties-handlers.ts`. */
export function broadcastVaultEntitiesStaleSignal(appWindows: readonly AppWindow[]): void {
	for (const win of appWindows) {
		if (!isAppWindowLive(win)) continue;
		try {
			win.webContents.send(APP_VAULT_ENTITIES_CHANGED_CHANNEL);
		} catch (error) {
			console.warn(`[brainstorm] vault-entities stale-signal to ${win.appId} failed:`, error);
		}
	}
	const extra = getExtraTarget?.();
	if (extra && !extra.webContents.isDestroyed()) {
		try {
			extra.webContents.send(APP_VAULT_ENTITIES_CHANGED_CHANNEL);
		} catch (error) {
			console.warn("[brainstorm] vault-entities stale-signal to dashboard failed:", error);
		}
	}
}
