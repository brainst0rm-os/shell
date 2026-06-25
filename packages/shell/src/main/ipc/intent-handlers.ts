/**
 * `intent:*` IPC handlers — privileged shell-side surface for the dashboard
 * renderer to dispatch intents to apps.
 *
 * The dashboard isn't an app, so it can't go through the broker (the
 * broker's identity check rejects unstamped envelopes). It also doesn't
 * have a capability ledger entry — the shell is the trust root. Routing
 * `intent.open` through this privileged surface lets the launcher palette
 * (Stage 9.22.2) jump to an entity by id without requiring the user to
 * launch the owning app manually first.
 *
 * `source: "shell"` makes the handler picker skip the same-app preference
 * (`pickHandler` in `intents-bus.ts`) — no app has that id, so the primary
 * registered handler wins.
 */

import { ipcMain } from "electron";
import type { IntentDispatchResult, IntentEnvelope, IntentsBus } from "../intents/intents-bus";

export const INTENT_DISPATCH_CHANNEL = "intent:dispatch";
/** Identifier passed as `source.app` for shell-originated dispatches.
 *  Not a real app id — no manifest installs as `shell`. Lets handler
 *  picking + future analytics distinguish dashboard / launcher dispatches
 *  from app-originated ones. */
export const SHELL_INTENT_SOURCE = "shell";

type IntentsBusGetter = () => IntentsBus | null | Promise<IntentsBus | null>;

export function registerIntentHandlers(getIntents: IntentsBusGetter): void {
	ipcMain.handle(
		INTENT_DISPATCH_CHANNEL,
		async (_event, envelope: unknown): Promise<IntentDispatchResult> => {
			const validated = validateIntentEnvelope(envelope);
			if (!validated) {
				return { handled: false, reason: "no-handler", message: "invalid envelope shape" };
			}
			const bus = await getIntents();
			if (!bus) {
				return { handled: false, reason: "no-handler", message: "intents bus not ready" };
			}
			try {
				return await bus.dispatch(validated, { app: SHELL_INTENT_SOURCE });
			} catch (error) {
				return { handled: false, reason: "handler-error", message: (error as Error).message };
			}
		},
	);
}

/** Pure validator. Same shape as the broker's intent-service argument
 *  guard — `verb` is a non-empty string, `payload` is a plain object. */
export function validateIntentEnvelope(input: unknown): IntentEnvelope | null {
	if (!input || typeof input !== "object" || Array.isArray(input)) return null;
	const raw = input as Record<string, unknown>;
	if (typeof raw.verb !== "string" || raw.verb.length === 0) return null;
	if (raw.payload === null || raw.payload === undefined) {
		return { verb: raw.verb, payload: {} };
	}
	if (typeof raw.payload !== "object" || Array.isArray(raw.payload)) return null;
	return { verb: raw.verb, payload: raw.payload as Record<string, unknown> };
}
