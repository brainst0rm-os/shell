/**
 * B11.17a — the `spellcheck` broker service: the capability-gated write path for
 * the per-vault custom dictionary. Unlike the B11.16c suggestion read/replace
 * (an app's own content returning to itself — ungated push channels), adding a
 * word mutates the SHARED Chromium dictionary that every app's spellcheck reads,
 * so it is gated by the `editor.spellcheck.write` capability (the broker checks
 * the grant before this runs); `listWords` needs `editor.spellcheck.read`.
 *
 * Methods:
 *   - listWords()         → string[]   the vault's persisted custom words
 *   - addWord(word)       → string[]   persist + add to the live session dict
 *   - removeWord(word)    → string[]   un-persist + remove from the session dict
 *   - ignoreWord(word)    → void       add to the session dict only (this run;
 *                                      not persisted — returns next vault-open)
 *
 * The session sink (the live `defaultSession` add/remove) is injected so the
 * handler is testable without Electron; the store I/O is the pure vault store.
 */

import type { ServiceHandler } from "../../ipc/broker";
import type { Envelope } from "../../ipc/envelope";
import {
	addWordToList,
	readSpellcheckDictionary,
	removeWordFromList,
	writeSpellcheckDictionary,
} from "../vault/vault-spellcheck-dictionary-store";

/** The live-session side of the dictionary (production: `defaultSession`). */
export type SpellcheckDictionarySink = {
	add(word: string): void;
	remove(word: string): void;
};

export type SpellcheckServiceOptions = {
	/** Absolute path of the active vault, or `null` when none is open. */
	getVaultPath: () => string | null;
	/** Apply to the live renderer session dictionary. */
	sink: SpellcheckDictionarySink;
};

export function makeSpellcheckServiceHandler(options: SpellcheckServiceOptions): ServiceHandler {
	const { getVaultPath, sink } = options;

	return async (envelope: Envelope): Promise<unknown> => {
		const vaultPath = getVaultPath();
		if (vaultPath === null) {
			throw makeError("Unavailable", "no active vault");
		}
		switch (envelope.method) {
			case "listWords":
				return await readSpellcheckDictionary(vaultPath);
			case "addWord": {
				const word = requireWord(envelope);
				const next = addWordToList(await readSpellcheckDictionary(vaultPath), word);
				await writeSpellcheckDictionary(vaultPath, next);
				sink.add(word.trim());
				return next;
			}
			case "removeWord": {
				const word = requireWord(envelope);
				const next = removeWordFromList(await readSpellcheckDictionary(vaultPath), word);
				await writeSpellcheckDictionary(vaultPath, next);
				sink.remove(word.trim());
				return next;
			}
			case "ignoreWord": {
				const word = requireWord(envelope);
				sink.add(word.trim());
				return undefined;
			}
			default:
				throw makeError("Invalid", `unknown spellcheck method: ${envelope.method}`);
		}
	};
}

function requireWord(envelope: Envelope): string {
	const arg = envelope.args[0];
	const word =
		typeof arg === "object" && arg !== null ? (arg as { word?: unknown }).word : undefined;
	if (typeof word !== "string" || word.trim().length === 0) {
		throw makeError("Invalid", "spellcheck word must be a non-empty string");
	}
	return word;
}

function makeError(kind: "Unavailable" | "Invalid", message: string): Error {
	const err = new Error(message);
	err.name = kind;
	return err;
}
