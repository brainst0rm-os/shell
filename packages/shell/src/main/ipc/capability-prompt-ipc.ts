/**
 * Wires the pure `CapabilityPromptHost` to Electron's ipcMain. Kept separate
 * from the host so the host stays Vitest-testable under Bun (which can't
 * resolve `electron`).
 */

import { ipcMain } from "electron";
import { CAPABILITY_PROMPT_REPLY_CHANNEL, type CapabilityPromptHost } from "./capability-prompt";

export function wireCapabilityPromptIpc(host: CapabilityPromptHost): void {
	ipcMain.on(
		CAPABILITY_PROMPT_REPLY_CHANNEL,
		(_event, reply: { requestId: string; accept: boolean }) => {
			host.handleReply(reply);
		},
	);
}
