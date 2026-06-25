import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CookieJarRepository, type CookieRecord, SameSitePolicy } from "../storage/cookie-jar-repo";
import { DataStores } from "../storage/data-stores";
import type { CookieSetSpec, ReadCookie } from "./cookie-serde";
import { type CookieSessionPort, WebCookieJar } from "./web-cookie-jar";

/** A fake Electron session: records injected cookies, lets the test fire
 *  `changed` events, and counts clears. */
function fakeSession() {
	const set: CookieSetSpec[] = [];
	let clears = 0;
	let listener: ((cookie: ReadCookie, removed: boolean) => void) | null = null;
	const port: CookieSessionPort = {
		setCookie: async (spec) => {
			set.push(spec);
		},
		clearCookies: async () => {
			clears += 1;
		},
		onChanged: (l) => {
			listener = l;
			return () => {
				listener = null;
			};
		},
	};
	return {
		port,
		set,
		clearCount: () => clears,
		hasListener: () => listener !== null,
		fire: (cookie: ReadCookie, removed: boolean) => listener?.(cookie, removed),
	};
}

const persisted: CookieRecord = {
	name: "session",
	domain: ".example.com",
	path: "/",
	value: "abc",
	hostOnly: false,
	secure: true,
	httpOnly: true,
	sameSite: SameSitePolicy.Lax,
	expiration: 4_000_000_000,
};

const liveCookie: ReadCookie = {
	name: "session",
	value: "abc",
	domain: ".example.com",
	hostOnly: false,
	path: "/",
	secure: true,
	httpOnly: true,
	session: false,
	expirationDate: 4_000_000_000,
	sameSite: "lax",
};

async function setup() {
	const vaultDir = await mkdtemp(join(tmpdir(), "brainstorm-jar-"));
	const stores = new DataStores(vaultDir);
	const repo = new CookieJarRepository(await stores.open("cookies"));
	const ses = fakeSession();
	// now fixed well before the sample's expiry so nothing is pruned.
	const jar = new WebCookieJar(repo, ses.port, () => 1_000_000_000_000);
	return { vaultDir, stores, repo, ses, jar };
}

describe("WebCookieJar", () => {
	let env: Awaited<ReturnType<typeof setup>>;
	beforeEach(async () => {
		env = await setup();
	});
	afterEach(async () => {
		env.stores.close();
		await rm(env.vaultDir, { recursive: true, force: true });
	});

	it("hydrate injects stored cookies and subscribes", async () => {
		env.repo.upsert(persisted);
		await env.jar.hydrate();
		expect(env.ses.set).toHaveLength(1);
		expect(env.ses.set[0]).toMatchObject({ url: "https://example.com/", name: "session" });
		expect(env.ses.hasListener()).toBe(true);
	});

	it("hydrate prunes expired cookies before injecting", async () => {
		env.repo.upsert({ ...persisted, name: "old", expiration: 1000 });
		env.repo.upsert(persisted);
		await env.jar.hydrate();
		expect(env.ses.set.map((s) => s.name)).toEqual(["session"]);
		expect(env.repo.listAll().map((c) => c.name)).toEqual(["session"]);
	});

	it("mirrors a live added cookie into the store", async () => {
		await env.jar.hydrate();
		env.ses.fire(liveCookie, false);
		expect(env.repo.listAll()).toEqual([persisted]);
	});

	it("mirrors a live removal out of the store", async () => {
		env.repo.upsert(persisted);
		await env.jar.hydrate();
		env.ses.fire(liveCookie, true);
		expect(env.repo.listAll()).toEqual([]);
	});

	it("ignores (and prunes) a session cookie change", async () => {
		env.repo.upsert(persisted);
		await env.jar.hydrate();
		env.ses.fire({ ...liveCookie, session: true }, false);
		expect(env.repo.listAll()).toEqual([]);
	});

	it("clear wipes the store and the live session", async () => {
		env.repo.upsert(persisted);
		await env.jar.hydrate();
		await env.jar.clear();
		expect(env.repo.listAll()).toEqual([]);
		expect(env.ses.clearCount()).toBe(1);
	});

	it("dispose unsubscribes and clears the live session but keeps the DB", async () => {
		env.repo.upsert(persisted);
		await env.jar.hydrate();
		await env.jar.dispose();
		expect(env.ses.hasListener()).toBe(false);
		expect(env.ses.clearCount()).toBe(1);
		// Rows survive so reopening the vault restores the login.
		expect(env.repo.listAll()).toEqual([persisted]);
		// A post-dispose change is ignored.
		env.ses.fire(liveCookie, true);
		expect(env.repo.listAll()).toEqual([persisted]);
	});
});
