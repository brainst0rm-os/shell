import { describe, expect, it } from "vitest";
import {
	DICTIONARY_KEY_PREFIX,
	PROPERTY_KEY_PREFIX,
	dictionaryStorageKey,
	newDictionaryId,
	newDictionaryItemId,
	newPropertyKey,
	propertyStorageKey,
} from "./properties-keys";

describe("id generators", () => {
	it("newPropertyKey produces a prefixed id matching prop_<base36>_<rand6>", () => {
		const key = newPropertyKey();
		expect(key).toMatch(/^prop_[0-9a-z]+_[0-9a-z]{1,6}$/);
	});

	it("newDictionaryId produces a prefixed id matching dict_<base36>_<rand6>", () => {
		const id = newDictionaryId();
		expect(id).toMatch(/^dict_[0-9a-z]+_[0-9a-z]{1,6}$/);
	});

	it("newDictionaryItemId produces a prefixed id matching di_<base36>_<rand6>", () => {
		const id = newDictionaryItemId();
		expect(id).toMatch(/^di_[0-9a-z]+_[0-9a-z]{1,6}$/);
	});

	it("generates unique ids across rapid calls", () => {
		const ids = new Set<string>();
		for (let i = 0; i < 1000; i += 1) ids.add(newPropertyKey());
		expect(ids.size).toBe(1000);
	});

	it("generates different prefixes per surface so storage keys can't collide", () => {
		expect(newPropertyKey().startsWith("prop_")).toBe(true);
		expect(newDictionaryId().startsWith("dict_")).toBe(true);
		expect(newDictionaryItemId().startsWith("di_")).toBe(true);
	});
});

describe("storage-key builders", () => {
	it("propertyStorageKey prepends the property: prefix exactly once", () => {
		expect(propertyStorageKey("prop_abc")).toBe(`${PROPERTY_KEY_PREFIX}prop_abc`);
	});

	it("dictionaryStorageKey prepends the dictionary: prefix exactly once", () => {
		expect(dictionaryStorageKey("dict_xyz")).toBe(`${DICTIONARY_KEY_PREFIX}dict_xyz`);
	});

	it("prefix constants are the literals the storage layer scans for", () => {
		expect(PROPERTY_KEY_PREFIX).toBe("property:");
		expect(DICTIONARY_KEY_PREFIX).toBe("dictionary:");
	});
});
