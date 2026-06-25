/**
 * 10.1 — `entity_deks` repo tests. Cover create + getByEntityId + delete,
 * the multi-version policy ("most recent by created_at"), and the
 * `ON DELETE CASCADE` from the parent entity.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateSymmetricKey, sealSecret } from "../../credentials/crypto";
import { DataStores } from "../data-stores";
import { EntitiesRepository } from "./entities-repo";
import { EntityDeksRepository } from "./entity-deks-repo";

async function setup() {
	const vaultDir = await mkdtemp(join(tmpdir(), "brainstorm-entity-deks-"));
	const stores = new DataStores(vaultDir);
	const db = await stores.open("entities");
	const entities = new EntitiesRepository(db);
	const deks = new EntityDeksRepository(db);
	const masterKey = generateSymmetricKey();
	return { vaultDir, stores, db, entities, deks, masterKey };
}

function sealedFixture(masterKey: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array) {
	return sealSecret(masterKey, plaintext, aad);
}

describe("EntityDeksRepository", () => {
	let env: Awaited<ReturnType<typeof setup>>;

	beforeEach(async () => {
		env = await setup();
		env.entities.create({
			id: "ent_owner",
			type: "io.x/Note/v1",
			properties: {},
			createdBy: "io.x",
			now: 100,
			dekId: null,
		});
	});

	afterEach(async () => {
		env.stores.close();
		await rm(env.vaultDir, { recursive: true, force: true });
	});

	it("create + getByEntityId round-trips, returns null for unknown entity", () => {
		const sealed = sealedFixture(env.masterKey, new Uint8Array(32));
		env.deks.create({
			dekId: "dek_1",
			entityId: "ent_owner",
			sealedDek: sealed,
			now: 200,
		});
		const row = env.deks.getByEntityId("ent_owner");
		expect(row).toMatchObject({
			dekId: "dek_1",
			entityId: "ent_owner",
			version: 1,
			createdAt: 200,
		});
		expect(row?.sealedDek).toEqual(sealed);
		expect(env.deks.getByEntityId("missing")).toBeNull();
	});

	it("delete removes the row and is idempotent", () => {
		const sealed = sealedFixture(env.masterKey, new Uint8Array(32));
		env.deks.create({ dekId: "dek_d", entityId: "ent_owner", sealedDek: sealed, now: 1 });
		expect(env.deks.delete("dek_d")).toBe(true);
		expect(env.deks.delete("dek_d")).toBe(false);
		expect(env.deks.getByEntityId("ent_owner")).toBeNull();
	});

	it("getByEntityId returns the most-recent-by-created_at row (rotation policy)", () => {
		// Forward-compat for Stage 10.2 rotation: writing multiple rows is
		// allowed; the read policy picks the newest. Stage 10.1 writes
		// exactly one row at create — this is the test that pins the policy.
		const dekA = sealedFixture(env.masterKey, new Uint8Array(32).fill(1));
		const dekB = sealedFixture(env.masterKey, new Uint8Array(32).fill(2));
		const dekC = sealedFixture(env.masterKey, new Uint8Array(32).fill(3));
		env.deks.create({ dekId: "dek_a", entityId: "ent_owner", sealedDek: dekA, now: 100 });
		env.deks.create({ dekId: "dek_c", entityId: "ent_owner", sealedDek: dekC, now: 300 });
		env.deks.create({ dekId: "dek_b", entityId: "ent_owner", sealedDek: dekB, now: 200 });
		const row = env.deks.getByEntityId("ent_owner");
		expect(row?.dekId).toBe("dek_c");
	});

	it("getByEntityId tie-breaks on version when created_at ties", () => {
		const dekA = sealedFixture(env.masterKey, new Uint8Array(32).fill(1));
		const dekB = sealedFixture(env.masterKey, new Uint8Array(32).fill(2));
		env.deks.create({
			dekId: "dek_v1",
			entityId: "ent_owner",
			sealedDek: dekA,
			now: 100,
			version: 1,
		});
		env.deks.create({
			dekId: "dek_v2",
			entityId: "ent_owner",
			sealedDek: dekB,
			now: 100,
			version: 2,
		});
		expect(env.deks.getByEntityId("ent_owner")?.dekId).toBe("dek_v2");
	});

	it("ON DELETE CASCADE drops the dek row when its entity is hard-deleted", () => {
		const sealed = sealedFixture(env.masterKey, new Uint8Array(32));
		env.deks.create({ dekId: "dek_x", entityId: "ent_owner", sealedDek: sealed, now: 1 });
		// Soft-delete then hard-delete the entity — the FK cascade fires on
		// the real DELETE. Both `bun:sqlite` and `better-sqlite3` honor it
		// when `PRAGMA foreign_keys=ON`; the storage layer enables it.
		env.entities.softDelete("ent_owner", 2);
		expect(env.entities.hardDelete("ent_owner")).toBe(true);
		expect(env.deks.getByEntityId("ent_owner")).toBeNull();
	});

	it("rejects an invalid SealedSecret shape on create", () => {
		expect(() =>
			env.deks.create({
				dekId: "dek_bad",
				entityId: "ent_owner",
				// biome-ignore lint/suspicious/noExplicitAny: testing the type-guard rejection path
				sealedDek: { v: 999, nonceB64: "x", ciphertextB64: "y" } as any,
				now: 1,
			}),
		).toThrow(/invalid sealedDek/i);
	});

	it("throws when stored JSON is malformed (defensive)", () => {
		env.db
			.prepare(
				"INSERT INTO entity_deks (dek_id, entity_id, version, sealed_dek_json, created_at) VALUES (?, ?, ?, ?, ?)",
			)
			.run("dek_corrupt", "ent_owner", 1, "{not json", 1);
		expect(() => env.deks.getByEntityId("ent_owner")).toThrow();
	});
});
