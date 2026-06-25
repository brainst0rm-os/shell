import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IntentDispatchResult, IntentEnvelope, IntentsBus } from "../intents/intents-bus";
import { DataStores } from "../storage/data-stores";
import { EntitiesRepository } from "../storage/entities-repo";
import { createAndOpenScratchNote } from "./notes-scratch";

let vaultDir: string;
let stores: DataStores;

beforeEach(async () => {
	vaultDir = await mkdtemp(join(tmpdir(), "brainstorm-notes-scratch-"));
	stores = new DataStores(vaultDir);
});

afterEach(async () => {
	stores.close();
	await rm(vaultDir, { recursive: true, force: true });
});

type DispatchCall = { envelope: IntentEnvelope; source: { app: string } };

function fakeIntents(): {
	bus: IntentsBus;
	calls: DispatchCall[];
} {
	const calls: DispatchCall[] = [];
	const bus = {
		async dispatch(envelope: IntentEnvelope, source: { app: string }): Promise<IntentDispatchResult> {
			calls.push({ envelope, source });
			return { handled: true, handler: { appId: "io.brainstorm.notes" } };
		},
	} as unknown as IntentsBus;
	return { bus, calls };
}

describe("createAndOpenScratchNote", () => {
	it("creates a Note/v1 row in entities.db and dispatches intent.open with its id", async () => {
		const db = await stores.open("entities");
		const repo = new EntitiesRepository(db);
		const { bus, calls } = fakeIntents();
		let staleCount = 0;

		const result = await createAndOpenScratchNote({
			getRepo: async () => repo,
			getIntents: () => bus,
			broadcastVaultEntitiesStale: () => {
				staleCount += 1;
			},
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.entityId).toMatch(/^ent_/);

		const row = repo.get(result.entityId);
		expect(row).not.toBeNull();
		expect(row?.type).toBe("io.brainstorm.notes/Note/v1");

		expect(staleCount).toBe(1);
		expect(calls).toHaveLength(1);
		const call = calls[0];
		if (!call) throw new Error("unreachable");
		expect(call.envelope.verb).toBe("open");
		expect(call.envelope.payload.entityId).toBe(result.entityId);
		expect(call.envelope.payload.entityType).toBe("io.brainstorm.notes/Note/v1");
		expect(call.source.app).toBe("shell");
	});

	it("fails closed when no active vault session", async () => {
		const { bus } = fakeIntents();
		const result = await createAndOpenScratchNote({
			getRepo: async () => null,
			getIntents: () => bus,
			broadcastVaultEntitiesStale: () => {
				/* unused */
			},
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.reason).toMatch(/vault/i);
	});

	it("fails closed when intents bus is not ready", async () => {
		const db = await stores.open("entities");
		const repo = new EntitiesRepository(db);
		const result = await createAndOpenScratchNote({
			getRepo: async () => repo,
			getIntents: () => null,
			broadcastVaultEntitiesStale: () => {
				/* unused */
			},
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.reason).toMatch(/intents/i);
	});

	it("fails closed (returns {ok:false}) when bus.dispatch throws — never bubbles up to the IPC caller", async () => {
		const db = await stores.open("entities");
		const repo = new EntitiesRepository(db);
		const throwingBus = {
			async dispatch(): Promise<IntentDispatchResult> {
				throw new Error("simulated mid-vault-swap closure");
			},
		} as unknown as IntentsBus;
		let staleCount = 0;
		const result = await createAndOpenScratchNote({
			getRepo: async () => repo,
			getIntents: () => throwingBus,
			broadcastVaultEntitiesStale: () => {
				staleCount += 1;
			},
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.reason).toMatch(/dispatch failed/i);
		expect(result.reason).toMatch(/simulated mid-vault-swap closure/);
		// Dispatch-first ordering: the broadcast never fires when dispatch
		// throws (avoids flashing a phantom note in a Notes sidebar that
		// the user can't open).
		expect(staleCount).toBe(0);
	});

	it("dispatches BEFORE broadcasting so a pre-existing Notes window doesn't flash an unnamed row", async () => {
		const db = await stores.open("entities");
		const repo = new EntitiesRepository(db);
		const { bus, calls } = fakeIntents();
		const order: string[] = [];
		// Wrap dispatch + broadcast so we can assert call order.
		const orderedBus = {
			async dispatch(
				envelope: IntentEnvelope,
				source: { app: string },
			): Promise<IntentDispatchResult> {
				order.push("dispatch");
				return bus.dispatch(envelope, source);
			},
		} as unknown as IntentsBus;
		await createAndOpenScratchNote({
			getRepo: async () => repo,
			getIntents: () => orderedBus,
			broadcastVaultEntitiesStale: () => {
				order.push("broadcast");
			},
		});
		expect(order).toEqual(["dispatch", "broadcast"]);
		expect(calls).toHaveLength(1);
	});
});
