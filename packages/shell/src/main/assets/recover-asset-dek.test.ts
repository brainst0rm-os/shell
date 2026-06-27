import { describe, expect, it } from "vitest";
import { sealAssetDekUnderEntity } from "../credentials/asset-dek-wrap";
import { generateSymmetricKey } from "../credentials/crypto";
import type { EntityDekStore } from "../entities/entity-dek-store";
import type { AssetDekStore } from "./asset-dek-store";
import { recoverAssetDek } from "./recover-asset-dek";

const ENTITY = "ent_x";
const ASSET = "asset-r1";

function assetStore(deks: Map<string, Uint8Array>): AssetDekStore {
	return {
		open: (id: string) => {
			const dek = deks.get(id);
			return dek ? { dekId: "d", dek: new Uint8Array(dek) } : null;
		},
		close: () => {},
	} as unknown as AssetDekStore;
}

function entityStore(deks: Map<string, Uint8Array>): EntityDekStore {
	return {
		open: (id: string) => {
			const dek = deks.get(id);
			return dek ? { dek: new Uint8Array(dek) } : null;
		},
		close: () => {},
	} as unknown as EntityDekStore;
}

describe("recoverAssetDek", () => {
	it("returns a copy from the local master-key cache when present", async () => {
		const assetDek = generateSymmetricKey();
		const got = await recoverAssetDek(
			{
				assetDekStore: assetStore(new Map([[ASSET, assetDek]])),
				entityDekStore: entityStore(new Map()),
				readAssetDekWrap: async () => null,
			},
			ENTITY,
			ASSET,
		);
		expect(got && Buffer.from(got).equals(Buffer.from(assetDek))).toBe(true);
	});

	it("recovers from the re-homed wrap on the entity Y.Doc (synced device)", async () => {
		const assetDek = generateSymmetricKey();
		const entityDek = generateSymmetricKey();
		const wrap = sealAssetDekUnderEntity(assetDek, entityDek, ENTITY, ASSET);
		const got = await recoverAssetDek(
			{
				assetDekStore: assetStore(new Map()), // no local cache (didn't mint it)
				entityDekStore: entityStore(new Map([[ENTITY, entityDek]])),
				readAssetDekWrap: async () => wrap,
			},
			ENTITY,
			ASSET,
		);
		expect(got && Buffer.from(got).equals(Buffer.from(assetDek))).toBe(true);
	});

	it("returns null when neither the cache nor a wrap can produce the key", async () => {
		const got = await recoverAssetDek(
			{
				assetDekStore: assetStore(new Map()),
				entityDekStore: entityStore(new Map()),
				readAssetDekWrap: async () => null,
			},
			ENTITY,
			ASSET,
		);
		expect(got).toBeNull();
	});

	it("returns null when the wrap is present but this device lacks the entity DEK", async () => {
		const wrap = sealAssetDekUnderEntity(
			generateSymmetricKey(),
			generateSymmetricKey(),
			ENTITY,
			ASSET,
		);
		const got = await recoverAssetDek(
			{
				assetDekStore: assetStore(new Map()),
				entityDekStore: entityStore(new Map()), // no entity DEK
				readAssetDekWrap: async () => wrap,
			},
			ENTITY,
			ASSET,
		);
		expect(got).toBeNull();
	});

	it("rejects a wrap that was sealed for a different entity (AAD binding)", async () => {
		const assetDek = generateSymmetricKey();
		const entityDek = generateSymmetricKey();
		// Wrap bound to a DIFFERENT entity, but served for ENTITY with ENTITY's DEK.
		const wrap = sealAssetDekUnderEntity(assetDek, entityDek, "other-entity", ASSET);
		await expect(
			recoverAssetDek(
				{
					assetDekStore: assetStore(new Map()),
					entityDekStore: entityStore(new Map([[ENTITY, entityDek]])),
					readAssetDekWrap: async () => wrap,
				},
				ENTITY,
				ASSET,
			),
		).rejects.toThrow();
	});
});
