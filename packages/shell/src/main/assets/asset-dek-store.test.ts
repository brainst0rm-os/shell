/**
 * AssetDekStore tests — the per-asset DEK wrap invariants, mirroring
 * `entity-dek-store.test.ts`:
 *   - seal → open round-trips the same DEK bytes.
 *   - AAD binding: opening with a wrap minted for a different asset id throws
 *     (DEK-swap defense).
 *   - master-key swap → open throws.
 *   - domain separation: an entity-DEK wrap cannot be opened as an asset DEK
 *     (distinct AAD prefix), even at the same id.
 *   - empty assetId rejected.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateSymmetricKey, sealSecret } from "../credentials/crypto";
import { DataStores } from "../storage/data-stores";
import { AssetDeksRepository, AssetsRepository } from "../storage/entities-repo";
import { AssetDekStore } from "./asset-dek-store";
import { AssetKind } from "./asset-types";

async function setup() {
	const vaultDir = await mkdtemp(join(tmpdir(), "brainstorm-asset-dek-"));
	const stores = new DataStores(vaultDir);
	const db = await stores.open("entities");
	const assets = new AssetsRepository(db);
	const deks = new AssetDeksRepository(db);
	const masterKey = generateSymmetricKey();
	const store = new AssetDekStore(deks, masterKey);
	return { vaultDir, stores, db, assets, deks, masterKey, store };
}

/** Seed a parent `assets` row so `asset_deks.asset_id` FK is satisfiable. */
function seedAsset(env: Awaited<ReturnType<typeof setup>>, id: string): void {
	env.assets.create({
		assetId: id,
		dekId: `${id}-dek`,
		contentHash: "0".repeat(64),
		mime: "image/png",
		byteLen: 1,
		kind: AssetKind.Favicon,
		now: 1,
	});
}

let env: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
	env = await setup();
});
afterEach(async () => {
	env.stores.close();
	await rm(env.vaultDir, { recursive: true, force: true });
});

describe("AssetDekStore", () => {
	it("seal → open round-trips the DEK bytes", () => {
		seedAsset(env, "a1");
		const dek = generateSymmetricKey();
		env.store.seal("a1", "a1-dek", dek);
		const handle = env.store.open("a1");
		if (!handle) throw new Error("expected a DEK handle");
		expect(handle.dek).toEqual(dek);
		env.store.close(handle.dek);
	});

	it("returns null when no wrap row exists", () => {
		expect(env.store.open("missing")).toBeNull();
	});

	it("throws when the wrap is opened under a different asset id (AAD swap)", () => {
		seedAsset(env, "a1");
		seedAsset(env, "a2");
		const dek = generateSymmetricKey();
		env.store.seal("a1", "a1-dek", dek);
		// Repoint a1's wrap row to a2 by hand, simulating a dek_id swap.
		env.db.prepare("UPDATE asset_deks SET asset_id = 'a2' WHERE asset_id = 'a1'").run();
		expect(() => env.store.open("a2")).toThrow();
	});

	it("throws under a different master key", () => {
		seedAsset(env, "a1");
		env.store.seal("a1", "a1-dek", generateSymmetricKey());
		const other = new AssetDekStore(env.deks, generateSymmetricKey());
		expect(() => other.open("a1")).toThrow();
	});

	it("does not open an entity-DEK-shaped wrap as an asset DEK (distinct domain)", () => {
		seedAsset(env, "a1");
		// A wrap sealed with the ENTITY prefix at the same id must not unwrap
		// under the ASSET store (distinct AAD prefix).
		const dek = generateSymmetricKey();
		const wrongDomain = sealSecret(
			env.masterKey,
			dek,
			new TextEncoder().encode("brainstorm/entity-dek/v1:a1"),
		);
		env.deks.create({ dekId: "a1-dek", assetId: "a1", sealedDek: wrongDomain, now: 1 });
		expect(() => env.store.open("a1")).toThrow();
	});

	it("rejects an empty assetId", () => {
		expect(() => env.store.seal("", "d", generateSymmetricKey())).toThrow();
		expect(() => env.store.open("")).toThrow();
	});
});
