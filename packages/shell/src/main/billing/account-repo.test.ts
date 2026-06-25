import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DataStores } from "../storage/data-stores";
import { AccountRepository } from "./account-repo";
import { EntitlementRepository } from "./entitlement-repo";
import { FeatureFlag, PlanTier } from "./plan";

async function setup() {
	const vaultDir = await mkdtemp(join(tmpdir(), "brainstorm-account-"));
	const stores = new DataStores(vaultDir);
	const db = await stores.open("account");
	return {
		vaultDir,
		stores,
		accounts: new AccountRepository(db),
		entitlements: new EntitlementRepository(db),
	};
}

describe("AccountRepository", () => {
	let env: Awaited<ReturnType<typeof setup>>;
	beforeEach(async () => {
		env = await setup();
	});
	afterEach(async () => {
		env.stores.close();
		await rm(env.vaultDir, { recursive: true, force: true });
	});

	it("getLinked returns null on a fresh (signed-out) vault", () => {
		expect(env.accounts.getLinked()).toBeNull();
	});

	it("link + getLinked round-trips", () => {
		env.accounts.link({
			id: "acc_1",
			email: "a@example.com",
			plan: PlanTier.Pro,
			linkedAt: 100,
			updatedAt: 100,
		});
		expect(env.accounts.getLinked()).toMatchObject({
			id: "acc_1",
			email: "a@example.com",
			plan: PlanTier.Pro,
		});
	});

	it("link is idempotent on id and updates mutable fields", () => {
		env.accounts.link({ id: "acc_1", email: null, plan: PlanTier.Plus, linkedAt: 1, updatedAt: 1 });
		env.accounts.link({
			id: "acc_1",
			email: "new@example.com",
			plan: PlanTier.Pro,
			linkedAt: 1,
			updatedAt: 2,
		});
		const linked = env.accounts.getLinked();
		expect(linked?.plan).toBe(PlanTier.Pro);
		expect(linked?.email).toBe("new@example.com");
		expect(env.accounts.get("acc_1")?.updatedAt).toBe(2);
	});

	it("getLinked returns the most recently linked account", () => {
		env.accounts.link({ id: "old", email: null, plan: PlanTier.Free, linkedAt: 1, updatedAt: 1 });
		env.accounts.link({ id: "new", email: null, plan: PlanTier.Pro, linkedAt: 5, updatedAt: 5 });
		expect(env.accounts.getLinked()?.id).toBe("new");
	});

	it("unlink removes the account", () => {
		env.accounts.link({ id: "acc_1", email: null, plan: PlanTier.Pro, linkedAt: 1, updatedAt: 1 });
		expect(env.accounts.unlink("acc_1")).toBe(true);
		expect(env.accounts.getLinked()).toBeNull();
		expect(env.accounts.unlink("acc_1")).toBe(false);
	});

	it("degrades an unknown stored plan to Free (fail-closed)", () => {
		env.accounts.link({ id: "acc_1", email: null, plan: PlanTier.Pro, linkedAt: 1, updatedAt: 1 });
		env.stores
			.get("account")
			?.prepare("UPDATE account SET plan = 'galaxy' WHERE id = ?")
			.run("acc_1");
		expect(env.accounts.getLinked()?.plan).toBe(PlanTier.Free);
	});
});

describe("EntitlementRepository", () => {
	let env: Awaited<ReturnType<typeof setup>>;
	beforeEach(async () => {
		env = await setup();
	});
	afterEach(async () => {
		env.stores.close();
		await rm(env.vaultDir, { recursive: true, force: true });
	});

	const sample = {
		accountId: "acc_1",
		token: "h.c.s",
		plan: PlanTier.Pro,
		features: [FeatureFlag.HostedRelay, FeatureFlag.BundledAiCredits],
		issuedAt: 1000,
		softExp: 2000,
		hardExp: 3000,
		cachedAt: 1000,
	};

	it("get returns null when nothing is cached", () => {
		expect(env.entitlements.get("acc_1")).toBeNull();
	});

	it("save + get round-trips including the features list", () => {
		env.entitlements.save(sample);
		expect(env.entitlements.get("acc_1")).toEqual(sample);
	});

	it("save is idempotent on account id", () => {
		env.entitlements.save(sample);
		env.entitlements.save({ ...sample, plan: PlanTier.Plus, features: [FeatureFlag.HostedRelay] });
		const got = env.entitlements.get("acc_1");
		expect(got?.plan).toBe(PlanTier.Plus);
		expect(got?.features).toEqual([FeatureFlag.HostedRelay]);
	});

	it("drops unknown feature flags on read (forward-compat)", () => {
		env.entitlements.save(sample);
		env.stores
			.get("account")
			?.prepare("UPDATE entitlement SET features = ? WHERE account_id = ?")
			.run(JSON.stringify(["hosted-relay", "warp-drive"]), "acc_1");
		expect(env.entitlements.get("acc_1")?.features).toEqual([FeatureFlag.HostedRelay]);
	});

	it("treats an unknown plan as absent (fail-closed)", () => {
		env.entitlements.save(sample);
		env.stores
			.get("account")
			?.prepare("UPDATE entitlement SET plan = 'galaxy' WHERE account_id = ?")
			.run("acc_1");
		expect(env.entitlements.get("acc_1")).toBeNull();
	});

	it("delete removes the cached entitlement", () => {
		env.entitlements.save(sample);
		expect(env.entitlements.delete("acc_1")).toBe(true);
		expect(env.entitlements.get("acc_1")).toBeNull();
	});
});
