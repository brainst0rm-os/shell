import { describe, expect, it } from "vitest";
import {
	type AssetDekWrap,
	isAssetDekWrap,
	openAssetDekUnderEntity,
	sealAssetDekUnderEntity,
} from "./asset-dek-wrap";
import { generateSymmetricKey } from "./crypto";

const ENTITY = "io.brainstorm.bookmarks/Bookmark/v1:abc";
const ASSET = "11111111-2222-3333-4444-555555555555";

describe("asset-dek-wrap", () => {
	it("round-trips an asset DEK sealed under the entity DEK", () => {
		const assetDek = generateSymmetricKey();
		const entityDek = generateSymmetricKey();
		const wrap = sealAssetDekUnderEntity(assetDek, entityDek, ENTITY, ASSET);

		expect(isAssetDekWrap(wrap)).toBe(true);
		const opened = openAssetDekUnderEntity(wrap, entityDek, ENTITY, ASSET);
		expect(opened).toEqual(assetDek);
	});

	it("rejects the wrong entity DEK (different key)", () => {
		const assetDek = generateSymmetricKey();
		const entityDek = generateSymmetricKey();
		const wrong = generateSymmetricKey();
		const wrap = sealAssetDekUnderEntity(assetDek, entityDek, ENTITY, ASSET);

		expect(() => openAssetDekUnderEntity(wrap, wrong, ENTITY, ASSET)).toThrow();
	});

	it("rejects a wrap replayed into a different entity (AAD binds entityId)", () => {
		const assetDek = generateSymmetricKey();
		const entityDek = generateSymmetricKey();
		const wrap = sealAssetDekUnderEntity(assetDek, entityDek, ENTITY, ASSET);

		expect(() =>
			openAssetDekUnderEntity(wrap, entityDek, "io.brainstorm.other/Thing/v1:zzz", ASSET),
		).toThrow();
	});

	it("rejects a wrap moved to a different asset slot (AAD binds assetId)", () => {
		const assetDek = generateSymmetricKey();
		const entityDek = generateSymmetricKey();
		const wrap = sealAssetDekUnderEntity(assetDek, entityDek, ENTITY, ASSET);

		expect(() =>
			openAssetDekUnderEntity(wrap, entityDek, ENTITY, "99999999-0000-0000-0000-000000000000"),
		).toThrow();
	});

	it("does not collide under (X, Y+Z) vs (X+Y, Z) id boundaries", () => {
		const assetDek = generateSymmetricKey();
		const entityDek = generateSymmetricKey();
		// "a" + NUL + "bc"  vs  "ab" + NUL + "c" must seal to distinct AADs.
		const wrap = sealAssetDekUnderEntity(assetDek, entityDek, "a", "bc");
		expect(() => openAssetDekUnderEntity(wrap, entityDek, "ab", "c")).toThrow();
		expect(openAssetDekUnderEntity(wrap, entityDek, "a", "bc")).toEqual(assetDek);
	});

	it("rejects a non-32-byte asset DEK at seal", () => {
		const entityDek = generateSymmetricKey();
		expect(() => sealAssetDekUnderEntity(new Uint8Array(16), entityDek, ENTITY, ASSET)).toThrow();
	});

	it("rejects a malformed wrap shape at open", () => {
		const entityDek = generateSymmetricKey();
		expect(() =>
			openAssetDekUnderEntity({ v: 1 } as unknown as AssetDekWrap, entityDek, ENTITY, ASSET),
		).toThrow(/invalid AssetDekWrap/);
	});
});
