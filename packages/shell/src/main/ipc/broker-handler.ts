/**
 * `broker:dispatch` ipcMain handler — the single entry point app renderers
 * use to call services. The renderer's preload stamps the envelope's `app`
 * field; the broker (here) verifies that stamp + checks capabilities +
 * routes to a service handler + ferries the reply back.
 *
 * Per docs/shell/12-shell-architecture.md §IPC architecture:
 *
 *   - Every host-service call passes through the broker.
 *   - The renderer is identified by `event.sender.id` (the WebContents id);
 *     the renderer-identity registry maps that to the trusted app id.
 *
 * Stage 5 wires this handler. The full service surface is filled in across
 * Stages 5b/9 as entities/files/intents come online. For Stage 5 the
 * registered services are `storage` (worker — ping) and `ydoc` (worker —
 * load/applyUpdate/snapshot), enough to demo a hello-world app.
 */

import type { IpcMainInvokeEvent } from "electron";
import { ipcMain } from "electron";
import { getWorkersHandle } from "../workers";

export const BROKER_CHANNEL = "broker:dispatch" as const;

export type BrokerHandlerDeps = {
	/** Record this dispatch as foreground activity (defers auto-lock). The caller
	 *  gates on window focus so background/unfocused renderers can't hold the lock
	 *  open. Omitted ⇒ no activity tracking (e.g. in tests). */
	noteActivity?: (event: IpcMainInvokeEvent) => void;
};

export function registerBrokerHandler(deps: BrokerHandlerDeps = {}): void {
	ipcMain.handle(BROKER_CHANNEL, async (event, raw: unknown) => {
		deps.noteActivity?.(event);
		const handle = getWorkersHandle();
		if (!handle) {
			return {
				v: 1,
				msg: pickMsg(raw),
				ok: false,
				error: {
					kind: "Unavailable",
					message: "broker not yet started",
				},
			};
		}
		// The renderer's WebContents id is the trusted source; the broker's
		// verifyAppIdentity closure resolves it against the renderer-identity
		// registry. Returning the typed reply unchanged — preload + SDK
		// runtime know how to interpret it.
		return await handle.broker.dispatch(raw, event.sender.id);
	});
}

function pickMsg(raw: unknown): string {
	if (raw && typeof raw === "object") {
		const m = (raw as { msg?: unknown }).msg;
		if (typeof m === "string") return m;
	}
	return "unknown";
}
