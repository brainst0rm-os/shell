/**
 * Spellcheck privileged IPC.
 *
 * B11.16c — the renderer → shell apply path for spellcheck suggestions: the
 * suggestion menu renders in the sandboxed app (fancy-menus); picking a word
 * sends it here and the shell replaces the calling renderer's current
 * misspelling via Electron's native `webContents.replaceMisspelling`.
 * `event.sender` is the trusted source — the replacement only ever touches that
 * renderer's own selection, so no broker capability is involved.
 *
 * B11.17b — the dashboard (privileged renderer, not a sandboxed app, so it uses
 * direct ipcMain not the broker) reads + prunes the per-vault custom dictionary
 * for the Settings manager, and reads the active spellcheck languages.
 */

import { type Session, session as electronSession, ipcMain } from "electron";
import { getActiveVaultSession } from "../vault/session";
import {
	readSpellcheckDictionary,
	removeWordFromList,
	writeSpellcheckDictionary,
} from "../vault/vault-spellcheck-dictionary-store";
import { SPELLCHECK_APPLY_CHANNEL } from "../web/spellcheck";

export const SPELLCHECK_LIST_WORDS_CHANNEL = "spellcheck:list-words" as const;
export const SPELLCHECK_REMOVE_WORD_CHANNEL = "spellcheck:remove-word" as const;
export const SPELLCHECK_LANGUAGES_CHANNEL = "spellcheck:languages" as const;

/** Active + available spellcheck languages (empty on macOS — the OS speller
 *  auto-detects and exposes no list). */
export type SpellcheckLanguagesInfo = {
	active: string[];
	available: string[];
};

export function registerSpellcheckHandlers(): void {
	ipcMain.on(SPELLCHECK_APPLY_CHANNEL, (event, replacement: unknown) => {
		if (typeof replacement === "string" && replacement.length > 0 && !event.sender.isDestroyed()) {
			event.sender.replaceMisspelling(replacement);
		}
	});

	ipcMain.handle(SPELLCHECK_LIST_WORDS_CHANNEL, async (): Promise<string[]> => {
		const vaultPath = getActiveVaultSession()?.vaultPath;
		return vaultPath ? readSpellcheckDictionary(vaultPath) : [];
	});

	ipcMain.handle(
		SPELLCHECK_REMOVE_WORD_CHANNEL,
		async (_event, word: unknown): Promise<string[]> => {
			const vaultPath = getActiveVaultSession()?.vaultPath;
			if (!vaultPath || typeof word !== "string") {
				return vaultPath ? readSpellcheckDictionary(vaultPath) : [];
			}
			const next = removeWordFromList(await readSpellcheckDictionary(vaultPath), word);
			await writeSpellcheckDictionary(vaultPath, next);
			electronSession.defaultSession.removeWordFromSpellCheckerDictionary(word);
			return next;
		},
	);

	ipcMain.handle(SPELLCHECK_LANGUAGES_CHANNEL, (): SpellcheckLanguagesInfo => {
		const ses: Session = electronSession.defaultSession;
		return {
			active: ses.getSpellCheckerLanguages(),
			available: ses.availableSpellCheckerLanguages,
		};
	});
}
