import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VaultSession, closeActiveVaultSession, setActiveVaultSession } from "../vault/session";
import { BrokerContext } from "./broker-context";

async function setup() {
	const vaultDir = await mkdtemp(join(tmpdir(), "brainstorm-bc-"));
	const session = await VaultSession.create({
		vaultId: "vlt_bc",
		vaultPath: vaultDir,
		forceInsecure: true,
	});
	setActiveVaultSession(session);
	return { vaultDir, session };
}

describe("BrokerContext", () => {
	let env: Awaited<ReturnType<typeof setup>>;

	beforeEach(async () => {
		env = await setup();
	});

	afterEach(async () => {
		closeActiveVaultSession();
		await rm(env.vaultDir, { recursive: true, force: true });
	});

	it("verifyAppIdentity reads from the renderer registry", () => {
		const ctx = new BrokerContext();
		ctx.identities.register(7, "io.example.app");
		expect(ctx.verifyAppIdentity("io.example.app", 7)).toBe(true);
		expect(ctx.verifyAppIdentity("io.example.app", 9)).toBe(false);
	});

	it("checkCapability fails closed when no ledger is warmed", () => {
		const ctx = new BrokerContext();
		// Active session exists but warmupLedger hasn't been called yet.
		expect(ctx.checkCapability("shell", "storage", "ping", ["storage.kv"])).toBe(false);
	});

	it("checkCapability succeeds after warmup with a matching grant (shell)", async () => {
		const ctx = new BrokerContext();
		await ctx.warmupLedger();
		// applyShellGrants ran during warmup → shell has storage.kv
		expect(ctx.checkCapability("shell", "storage", "ping", ["storage.kv"])).toBe(true);
	});

	it("checkCapability fails closed while the session is soft-locked (13.8c)", async () => {
		const ctx = new BrokerContext();
		await ctx.warmupLedger();
		expect(ctx.checkCapability("shell", "storage", "ping", ["storage.kv"])).toBe(true);
		// A soft-locked session stays `active` but must reject all app IPC behind
		// the lock screen (a hard lock would already null `active`).
		env.session.markLocked();
		expect(ctx.checkCapability("shell", "storage", "ping", ["storage.kv"])).toBe(false);
		env.session.markUnlocked();
		expect(ctx.checkCapability("shell", "storage", "ping", ["storage.kv"])).toBe(true);
	});

	it("checkCapability returns true when no caps are declared (method needs none)", async () => {
		const ctx = new BrokerContext();
		await ctx.warmupLedger();
		expect(ctx.checkCapability("any.app", "storage", "ping", [])).toBe(true);
	});

	it("checkCapability rejects an app with no matching grant", async () => {
		const ctx = new BrokerContext();
		await ctx.warmupLedger();
		expect(ctx.checkCapability("ghost.app", "storage", "ping", ["storage.kv"])).toBe(false);
	});

	it("onDenied writes an ipc.denied event into the active vault's audit log", async () => {
		const ctx = new BrokerContext();
		await ctx.warmupLedger();
		ctx.onDenied({
			kind: "CapabilityDenied",
			app: "io.example.app",
			service: "storage",
			method: "set",
			msg: "m1",
			reason: "missing capability",
		});
		// audit-log is best-effort — we don't await internal writes, so flush
		// briefly then check the file.
		await new Promise((r) => setTimeout(r, 50));
		const { readFile } = await import("node:fs/promises");
		const raw = await readFile(`${env.vaultDir}/logs/audit.log`, "utf8");
		const lines = raw
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l));
		const denied = lines.find((l) => l.kind === "ipc.denied");
		expect(denied).toBeDefined();
		expect(denied.deniedKind).toBe("CapabilityDenied");
		expect(denied.app).toBe("io.example.app");
		expect(denied.service).toBe("storage");
	});

	it("onDenied is a no-op when no vault is active", async () => {
		const ctx = new BrokerContext();
		closeActiveVaultSession();
		// Should not throw / not write anywhere.
		expect(() =>
			ctx.onDenied({
				kind: "Invalid",
				app: "x",
				service: "s",
				method: "m",
				msg: "n",
				reason: "no session",
			}),
		).not.toThrow();
	});

	it("invalidate clears the cached ledger so warmup must run again", async () => {
		const ctx = new BrokerContext();
		await ctx.warmupLedger();
		expect(ctx.checkCapability("shell", "storage", "ping", ["storage.kv"])).toBe(true);
		ctx.invalidate();
		expect(ctx.checkCapability("shell", "storage", "ping", ["storage.kv"])).toBe(false);
	});

	it("a switched vault session invalidates the cached ledger", async () => {
		const ctx = new BrokerContext();
		await ctx.warmupLedger();

		// Switch to a brand-new vault session.
		const otherDir = await mkdtemp(join(tmpdir(), "brainstorm-bc-other-"));
		try {
			const other = await VaultSession.create({
				vaultId: "vlt_other",
				vaultPath: otherDir,
				forceInsecure: true,
			});
			setActiveVaultSession(other); // disposes the prior one
			// Cached ledger was for the prior session id; the check should miss
			// until warmup runs against the new session.
			expect(ctx.checkCapability("shell", "storage", "ping", ["storage.kv"])).toBe(false);
			await ctx.warmupLedger();
			expect(ctx.checkCapability("shell", "storage", "ping", ["storage.kv"])).toBe(true);
		} finally {
			await rm(otherDir, { recursive: true, force: true });
		}
	});

	// Regression: a hard-lock → unlock cycle disposes the VaultSession (closing
	// ledger.db) and re-opens a NEW session with the SAME vaultId + path. Keying
	// the broker cache on the vaultId STRING returned the stale ledger wrapping a
	// now-closed DB, so `has()` threw "database connection is not open" and every
	// app IPC failed with LedgerUnavailable. Keying on the session INSTANCE must
	// bust the cache here: fail closed (denial) until the unlock path re-warms,
	// never reuse the disposed session's ledger.
	it("re-opening the SAME vaultId (hard-lock unlock) fails closed, never reuses the closed ledger", async () => {
		const ctx = new BrokerContext();
		await ctx.warmupLedger();
		expect(ctx.checkCapability("shell", "storage", "ping", ["storage.kv"])).toBe(true);

		// Hard-lock: dispose the active session — this closes ledger.db. The
		// broker still holds the (now stale) cached ledger from the warmup above.
		const { vaultId, vaultPath } = env.session;
		closeActiveVaultSession();

		// Unlock: re-open a brand-new session for the SAME vault (same id + path).
		const reopened = await VaultSession.open(vaultId, vaultPath, { forceInsecure: true });
		setActiveVaultSession(reopened);

		// Before the unlock path re-warms: must fail closed, NOT throw by calling
		// `has()` on the disposed session's closed DB handle.
		expect(() => ctx.checkCapability("shell", "storage", "ping", ["storage.kv"])).not.toThrow();
		expect(ctx.checkCapability("shell", "storage", "ping", ["storage.kv"])).toBe(false);

		// After re-warm against the fresh session the ledger answers again.
		await ctx.warmupLedger();
		expect(ctx.checkCapability("shell", "storage", "ping", ["storage.kv"])).toBe(true);
	});
});
