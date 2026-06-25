/**
 * BUG 2 helper — `deriveVaultKey` produces a stable per-vault discriminator
 * from the root Folder's `createdAt` so the renderer-local view-options blob
 * is isolated per vault (the app-origin localStorage is shared and
 * `ROOT_FOLDER_ID` is a fixed constant).
 */

import { describe, expect, it } from "vitest";
import { deriveVaultKey } from "../src/store/use-files-store";
import type { VaultEntityShape } from "../src/types/runtime";

const ROOT = "brainstorm/root-folder/v1";

function root(createdAt: number): VaultEntityShape {
	return {
		id: ROOT,
		type: "brainstorm/Folder/v1",
		properties: {},
		createdAt,
		updatedAt: createdAt,
		deletedAt: null,
	};
}

describe("deriveVaultKey (BUG 2)", () => {
	it("derives a key from the root folder's createdAt", () => {
		expect(deriveVaultKey([root(1700)])).toBe("v1700");
	});

	it("distinct vaults (distinct root createdAt) yield distinct keys", () => {
		expect(deriveVaultKey([root(1700)])).not.toBe(deriveVaultKey([root(1800)]));
	});

	it("is undefined when no root row is present (backward-tolerant fallback)", () => {
		expect(deriveVaultKey([])).toBeUndefined();
		expect(
			deriveVaultKey([
				{
					id: "fld_x",
					type: "brainstorm/Folder/v1",
					properties: {},
					createdAt: 5,
					updatedAt: 5,
					deletedAt: null,
				},
			]),
		).toBeUndefined();
	});

	it("is undefined when createdAt is missing/zero", () => {
		expect(deriveVaultKey([root(0)])).toBeUndefined();
	});
});
