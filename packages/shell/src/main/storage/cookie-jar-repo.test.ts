import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CookieJarRepository, type CookieRecord, SameSitePolicy } from "./cookie-jar-repo";
import { DataStores } from "./data-stores";

async function setup() {
	const vaultDir = await mkdtemp(join(tmpdir(), "brainstorm-cookies-"));
	const stores = new DataStores(vaultDir);
	const db = await stores.open("cookies");
	const repo = new CookieJarRepository(db);
	return { vaultDir, stores, repo };
}

const sample: CookieRecord = {
	name: "session",
	domain: ".example.com",
	path: "/",
	value: "abc123",
	hostOnly: false,
	secure: true,
	httpOnly: true,
	sameSite: SameSitePolicy.Lax,
	expiration: 4_000_000_000,
};

describe("CookieJarRepository", () => {
	let env: Awaited<ReturnType<typeof setup>>;
	beforeEach(async () => {
		env = await setup();
	});
	afterEach(async () => {
		env.stores.close();
		await rm(env.vaultDir, { recursive: true, force: true });
	});

	it("upsert + listAll round-trips every field", () => {
		env.repo.upsert(sample);
		expect(env.repo.listAll()).toEqual([sample]);
	});

	it("upsert replaces by (name, domain, path) identity", () => {
		env.repo.upsert(sample);
		env.repo.upsert({ ...sample, value: "rotated" });
		const all = env.repo.listAll();
		expect(all).toHaveLength(1);
		expect(all[0]?.value).toBe("rotated");
	});

	it("a cookie differing only in path is a distinct row", () => {
		env.repo.upsert(sample);
		env.repo.upsert({ ...sample, path: "/app" });
		expect(env.repo.listAll()).toHaveLength(2);
	});

	it("delete removes by identity tuple", () => {
		env.repo.upsert(sample);
		env.repo.delete({ name: "session", domain: ".example.com", path: "/" });
		expect(env.repo.listAll()).toEqual([]);
	});

	it("upsertMany is transactional and bulk-inserts", () => {
		env.repo.upsertMany([sample, { ...sample, name: "csrf" }]);
		expect(env.repo.listAll()).toHaveLength(2);
	});

	it("deleteExpired drops only cookies at/below the cutoff", () => {
		env.repo.upsert({ ...sample, name: "old", expiration: 1000 });
		env.repo.upsert({ ...sample, name: "fresh", expiration: 5000 });
		expect(env.repo.deleteExpired(1000)).toBe(1);
		expect(env.repo.listAll().map((c) => c.name)).toEqual(["fresh"]);
	});

	it("clear wipes the whole jar", () => {
		env.repo.upsertMany([sample, { ...sample, name: "csrf" }]);
		expect(env.repo.clear()).toBe(2);
		expect(env.repo.listAll()).toEqual([]);
	});

	it("preserves host-only and unspecified-sameSite cookies verbatim", () => {
		const hostOnly: CookieRecord = {
			...sample,
			name: "ho",
			domain: "host.example.com",
			hostOnly: true,
			secure: false,
			httpOnly: false,
			sameSite: SameSitePolicy.Unspecified,
		};
		env.repo.upsert(hostOnly);
		expect(env.repo.listAll()).toEqual([hostOnly]);
	});
});
