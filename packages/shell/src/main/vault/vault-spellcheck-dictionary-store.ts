/**
 * B11.17a — per-vault custom spellcheck dictionary persistence (OQ-SP-2).
 *
 * The user's personal word list ("Brainstorm", a surname, a domain term) lives
 * at `<vaultPath>/shell/spellcheck-dictionary.json` — the same `shell/`
 * convention `network-settings.json` / `shortcut-bindings.json` use, so it
 * travels with a vault copy/export. (True cross-device CRDT sync over the
 * Stage-10 engine — which syncs entities/Y.Docs, not shell config — is a
 * follow-up; vault-resident is the v1 contract.) On vault-open the words are
 * hydrated into the renderer session via `session.addWordToSpellCheckerDictionary`
 * (the shell side; see launch-setup).
 *
 * Pure I/O + pure list ops — fully testable under Bun. Never throws: a missing /
 * corrupt file reads as an empty list.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const SPELLCHECK_DICTIONARY_FILENAME = "spellcheck-dictionary.json";

/** `<vault>/shell/spellcheck-dictionary.json`. */
export function spellcheckDictionaryPath(vaultPath: string): string {
	return join(vaultPath, "shell", SPELLCHECK_DICTIONARY_FILENAME);
}

/** Normalize a candidate word: trim surrounding whitespace. Empty ⇒ null
 *  (rejected). Case is preserved — the OS speller matches case-insensitively
 *  but the stored form is what the user typed. */
function normalizeWord(word: string): string | null {
	const trimmed = word.trim();
	return trimmed.length === 0 ? null : trimmed;
}

/** Add `word` to `words`, trimmed + de-duplicated (case-insensitive compare so
 *  "Brainstorm" and "brainstorm" don't both land). Returns a new array; the
 *  original on a blank/duplicate word. */
export function addWordToList(words: readonly string[], word: string): string[] {
	const normalized = normalizeWord(word);
	if (normalized === null) return [...words];
	const lower = normalized.toLowerCase();
	if (words.some((w) => w.toLowerCase() === lower)) return [...words];
	return [...words, normalized];
}

/** Remove `word` from `words` (case-insensitive). Returns a new array. */
export function removeWordFromList(words: readonly string[], word: string): string[] {
	const lower = word.trim().toLowerCase();
	return words.filter((w) => w.toLowerCase() !== lower);
}

/** Coerce arbitrary parsed JSON to a clean word list (array of non-empty
 *  trimmed strings, de-duplicated). One bad row never throws. */
export function coerceWordList(parsed: unknown): string[] {
	if (!Array.isArray(parsed)) return [];
	let words: string[] = [];
	for (const entry of parsed) {
		if (typeof entry === "string") words = addWordToList(words, entry);
	}
	return words;
}

/** Read the vault's custom words. Empty list on missing / corrupt file. */
export async function readSpellcheckDictionary(vaultPath: string): Promise<string[]> {
	try {
		const raw = await readFile(spellcheckDictionaryPath(vaultPath), "utf8");
		return coerceWordList(JSON.parse(raw));
	} catch (error) {
		if (!isNotFound(error)) {
			console.warn("[brainstorm] spellcheck-dictionary.json read failed; using empty list:", error);
		}
		return [];
	}
}

/** Persist `words` (a torn write becomes the next-read empty fallback — the
 *  safe direction). */
export async function writeSpellcheckDictionary(
	vaultPath: string,
	words: readonly string[],
): Promise<void> {
	const path = spellcheckDictionaryPath(vaultPath);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(words, null, 2)}\n`, "utf8");
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code: unknown }).code === "ENOENT"
	);
}
