import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SitePermissionKind } from "@brainstorm/sdk-types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSitePermissionGrants, writeSitePermissionGrants } from "./site-permissions";
import { writeWebEgressRows } from "./web-egress-audit";
import { createWebPrivacyRuntime } from "./web-privacy-runtime";

const origin = "https://example.com";

describe("createWebPrivacyRuntime", () => {
	let vaultA: string;
	let vaultB: string;

	beforeEach(async () => {
		vaultA = await mkdtemp(join(tmpdir(), "bs-webpriv-a-"));
		vaultB = await mkdtemp(join(tmpdir(), "bs-webpriv-b-"));
	});

	afterEach(async () => {
		await rm(vaultA, { recursive: true, force: true });
		await rm(vaultB, { recursive: true, force: true });
	});

	it("fails closed with no active vault", async () => {
		const runtime = createWebPrivacyRuntime({ getVaultPath: () => null });
		expect(runtime.permissions.decision(origin, SitePermissionKind.Camera)).toBeNull();
		expect(await runtime.permissions.list()).toEqual([]);
		runtime.egress.record("a.com", false);
		expect(await runtime.egress.summary()).toEqual([]);
		await runtime.dispose();
	});

	it("set persists a grant and decision reads it back", async () => {
		const runtime = createWebPrivacyRuntime({ getVaultPath: () => vaultA, now: () => 42 });
		await runtime.permissions.set(origin, SitePermissionKind.Camera, true);
		expect(runtime.permissions.decision(origin, SitePermissionKind.Camera)).toBe(true);
		expect(await readSitePermissionGrants(vaultA)).toEqual([
			{ origin, permission: SitePermissionKind.Camera, allow: true, updatedAt: 42 },
		]);
		await runtime.dispose();
	});

	it("loads existing grants for the active vault", async () => {
		await writeSitePermissionGrants(vaultA, [
			{ origin, permission: SitePermissionKind.Geolocation, allow: false, updatedAt: 1 },
		]);
		const runtime = createWebPrivacyRuntime({ getVaultPath: () => vaultA });
		await runtime.permissions.whenLoaded();
		expect(runtime.permissions.decision(origin, SitePermissionKind.Geolocation)).toBe(false);
		await runtime.dispose();
	});

	it("revokeOrigin clears decisions and rewrites the file", async () => {
		const runtime = createWebPrivacyRuntime({ getVaultPath: () => vaultA });
		await runtime.permissions.set(origin, SitePermissionKind.Camera, true);
		expect(await runtime.permissions.revokeOrigin(origin)).toBe(true);
		expect(runtime.permissions.decision(origin, SitePermissionKind.Camera)).toBeNull();
		expect(await readSitePermissionGrants(vaultA)).toEqual([]);
		await runtime.dispose();
	});

	it("re-keys on vault switch — grants never leak across vaults", async () => {
		let active = vaultA;
		const runtime = createWebPrivacyRuntime({ getVaultPath: () => active });
		await runtime.permissions.set(origin, SitePermissionKind.Camera, true);
		active = vaultB;
		await runtime.permissions.whenLoaded();
		expect(runtime.permissions.decision(origin, SitePermissionKind.Camera)).toBeNull();
		active = vaultA;
		await runtime.permissions.whenLoaded();
		expect(runtime.permissions.decision(origin, SitePermissionKind.Camera)).toBe(true);
		await runtime.dispose();
	});

	it("egress summary merges the persisted aggregate with live records", async () => {
		await writeWebEgressRows(vaultA, [{ host: "a.com", count: 3, blockedCount: 1, lastSeenMs: 5 }]);
		const runtime = createWebPrivacyRuntime({ getVaultPath: () => vaultA, now: () => 9 });
		runtime.egress.record("a.com", false);
		const rows = await runtime.egress.summary();
		expect(rows).toEqual([{ host: "a.com", count: 4, blockedCount: 1, lastSeenMs: 9 }]);
		await runtime.dispose();
	});
});
