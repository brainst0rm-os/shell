/**
 * BinService — recovery-side logic over a real `EntitiesRepository`
 * (in-memory DataStores). Soft-delete happens via the entities service
 * (`repo.softDelete`); these tests assert list / restore / purge / empty
 * plus the title+icon derivation (must match the dashboard pin resolver)
 * and the no-vault degradation.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DataStores } from "../storage/data-stores";
import { EntitiesRepository } from "../storage/entities-repo";
import { BinService } from "./bin-service";

async function setup() {
	const vaultDir = await mkdtemp(join(tmpdir(), "brainstorm-bin-"));
	const stores = new DataStores(vaultDir);
	const repo = new EntitiesRepository(await stores.open("entities"));
	let clock = 1000;
	const service = new BinService({ getRepo: () => repo, now: () => clock });
	return {
		vaultDir,
		stores,
		repo,
		service,
		tick: (n: number) => {
			clock = n;
		},
	};
}

describe("BinService", () => {
	let env: Awaited<ReturnType<typeof setup>>;
	beforeEach(async () => {
		env = await setup();
	});
	afterEach(async () => {
		env.stores.close();
		await rm(env.vaultDir, { recursive: true, force: true });
	});

	const seed = (id: string, properties: Record<string, unknown>, now = 1000) =>
		env.repo.create({ id, type: "io.x/Note/v1", properties, createdBy: "io.x", now, dekId: null });

	it("list derives title (title→name→id) + icon, most-recent-first", () => {
		seed("a", { title: "Alpha", icon: { kind: "emoji", value: "🎯" } });
		seed("b", { name: "Bravo" });
		seed("c", {}); // no title/name → id fallback
		expect(env.service.list()).toEqual([]); // nothing deleted yet
		env.repo.softDelete("a", 2000);
		env.repo.softDelete("b", 2500);
		env.repo.softDelete("c", 3000);

		const items = env.service.list();
		expect(items.map((i) => [i.id, i.title])).toEqual([
			["c", "c"],
			["b", "Bravo"],
			["a", "Alpha"],
		]);
		expect(items[2]?.icon).toMatchObject({ value: "🎯" });
		expect(items[1]?.icon).toBeNull();
		expect(items[0]?.deletedAt).toBe(3000);
	});

	it("restore brings an item back and is idempotent", () => {
		seed("a", { title: "Alpha" });
		env.repo.softDelete("a", 2000);
		env.tick(2500);
		expect(env.service.restore("a")).toBe(true);
		expect(env.service.list()).toEqual([]);
		expect(env.repo.get("a")).toMatchObject({ id: "a" });
		expect(env.service.restore("a")).toBe(false); // already live
		expect(env.service.restore("nope")).toBe(false);
		expect(env.service.restore("")).toBe(false);
	});

	it("purge permanently removes a binned item; refuses a live one", async () => {
		seed("a", { title: "Alpha" });
		expect(await env.service.purge("a")).toBe(false); // live → refused
		env.repo.softDelete("a", 2000);
		expect(await env.service.purge("a")).toBe(true);
		expect(env.service.list()).toEqual([]);
		expect(env.repo.get("a")).toBeNull();
		expect(await env.service.purge("a")).toBe(false); // idempotent
	});

	it("empty purges every binned item and returns the count", async () => {
		seed("a", {});
		seed("b", {});
		seed("c", {});
		env.repo.softDelete("a", 2000);
		env.repo.softDelete("b", 2000);
		expect(await env.service.empty()).toBe(2);
		expect(env.service.list()).toEqual([]);
		expect(env.repo.get("c")).toMatchObject({ id: "c" }); // untouched (live)
		expect(await env.service.empty()).toBe(0); // bin already empty
	});

	it("reaps a purged upload's blob only once nothing else references it", async () => {
		const reaped: string[] = [];
		const svc = new BinService({
			getRepo: () => env.repo,
			deleteAsset: async (assetId) => {
				reaped.push(assetId);
			},
		});
		// Two binned uploads sharing one blob, plus a live upload on a second blob.
		seed("a", { assetId: "blob-1" });
		seed("b", { assetId: "blob-1" });
		seed("live", { assetId: "blob-2" });
		env.repo.softDelete("a", 2000);
		env.repo.softDelete("b", 2000);

		expect(await svc.purge("a")).toBe(true);
		expect(reaped).toEqual([]); // "b" still in the Bin holds blob-1

		expect(await svc.purge("b")).toBe(true);
		expect(reaped).toEqual(["blob-1"]); // now unreachable → reaped

		// A purge whose blob is still referenced by a LIVE entity never reaps.
		env.repo.softDelete("live", 3000);
		// Re-create a live referrer of blob-2 so the binned one isn't the last.
		seed("live2", { assetId: "blob-2" }, 3000);
		expect(await svc.purge("live")).toBe(true);
		expect(reaped).toEqual(["blob-1"]);
	});

	it("degrades to empty/false when no vault repo is available", async () => {
		const offline = new BinService({ getRepo: () => null });
		expect(offline.list()).toEqual([]);
		expect(offline.restore("a")).toBe(false);
		expect(await offline.purge("a")).toBe(false);
		expect(await offline.empty()).toBe(0);
		expect(offline.purgeExpired(30)).toBe(0);
	});

	it("purgeExpired removes only items past the retention cutoff (9.8.8)", () => {
		const DAY = 86_400_000;
		seed("old", { title: "Old" });
		seed("fresh", { title: "Fresh" });
		seed("live", { title: "Live" });
		env.repo.softDelete("old", 1000);
		env.repo.softDelete("fresh", 1000 + 35 * DAY);
		env.tick(1000 + 40 * DAY); // old is 40 days gone, fresh only 5

		expect(env.service.purgeExpired(30)).toBe(1);
		expect(env.service.list().map((i) => i.id)).toEqual(["fresh"]);
		expect(env.repo.get("live")).toMatchObject({ id: "live" }); // live untouched
		expect(env.service.purgeExpired(30)).toBe(0); // idempotent
	});

	it("purgeExpired with the boundary exactly at the cutoff keeps the item", () => {
		const DAY = 86_400_000;
		seed("edge", { title: "Edge" });
		env.repo.softDelete("edge", 1000);
		env.tick(1000 + 30 * DAY); // deletedAt === cutoff → NOT strictly older

		expect(env.service.purgeExpired(30)).toBe(0);
		expect(env.service.list().map((i) => i.id)).toEqual(["edge"]);
	});

	it("purgeExpired never sweeps under RETENTION_FOREVER / junk windows", () => {
		seed("a", {});
		env.repo.softDelete("a", 1000);
		env.tick(Number.MAX_SAFE_INTEGER);

		expect(env.service.purgeExpired(0)).toBe(0); // forever
		expect(env.service.purgeExpired(-5)).toBe(0);
		expect(env.service.purgeExpired(Number.NaN)).toBe(0);
		expect(env.service.list().map((i) => i.id)).toEqual(["a"]);
	});
});
