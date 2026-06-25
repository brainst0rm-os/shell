/**
 * Wires the pure `OsHandoffPromptHost` to Electron's ipcMain. Kept
 * separate from the host so the host stays Vitest-testable under Bun
 * (which can't resolve `electron`). Mirrors `capability-prompt-ipc.ts`.
 */

import { ipcMain } from "electron";
import {
	OS_HANDOFF_PROMPT_REPLY_CHANNEL,
	type OsHandoffPromptDecision,
	type OsHandoffPromptHost,
} from "./os-handoff-prompt";

export function wireOsHandoffPromptIpc(host: OsHandoffPromptHost): void {
	ipcMain.on(
		OS_HANDOFF_PROMPT_REPLY_CHANNEL,
		(_event, reply: { requestId: string; decision: OsHandoffPromptDecision }) => {
			host.handleReply(reply);
		},
	);
}
