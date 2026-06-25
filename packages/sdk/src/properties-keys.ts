/**
 * Stable id generators + storage-key builders for vault-level
 * properties + dictionaries.
 *
 * Pure functions (one `Date.now()` + `Math.random()` per call); safe
 * to use on either side of the broker. Lifted out of the Notes app
 * during VP-1 so every app shares the same id shapes — `prop_<…>` ids
 * minted from Notes and Database are indistinguishable at the storage
 * layer.
 */

const RAND_LEN = 6;

function suffix(): string {
	const t = Date.now().toString(36);
	const r = Math.random()
		.toString(36)
		.slice(2, 2 + RAND_LEN);
	return `${t}_${r}`;
}

export function newPropertyKey(): string {
	return `prop_${suffix()}`;
}

export function newDictionaryId(): string {
	return `dict_${suffix()}`;
}

export function newDictionaryItemId(): string {
	return `di_${suffix()}`;
}

/** Prefix for the shell's vault-level properties YDoc Y.Map key namespace
 *  AND for any legacy interim storage.kv records (pre-VP-2). Apps don't
 *  scan against this prefix directly any more — they go through the SDK
 *  `properties` service from VP-3. */
export const PROPERTY_KEY_PREFIX = "property:";

/** Prefix for the dictionaries Y.Map / legacy storage.kv records. */
export const DICTIONARY_KEY_PREFIX = "dictionary:";

export function propertyStorageKey(key: string): string {
	return `${PROPERTY_KEY_PREFIX}${key}`;
}

export function dictionaryStorageKey(id: string): string {
	return `${DICTIONARY_KEY_PREFIX}${id}`;
}
