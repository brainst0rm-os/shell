import { describe, expect, it, vi } from "vitest";
import {
	type Migration,
	VaultFormatPreFreezeError,
	VaultFormatTooNew,
	assertVaultFormatNotPreFreeze,
	assertVaultFormatSupported,
	compareDottedVersions,
	runMigrations,
} from "./schema-version";

describe("compareDottedVersions", () => {
	it("returns 0 for identical versions", () => {
		expect(compareDottedVersions("1.0", "1.0")).toBe(0);
		expect(compareDottedVersions("1.0.0", "1.0.0")).toBe(0);
	});

	it("returns -1 when left is older", () => {
		expect(compareDottedVersions("1.0", "1.1")).toBe(-1);
		expect(compareDottedVersions("1.9", "2.0")).toBe(-1);
		expect(compareDottedVersions("1.0.0", "1.0.1")).toBe(-1);
	});

	it("returns 1 when left is newer", () => {
		expect(compareDottedVersions("1.1", "1.0")).toBe(1);
		expect(compareDottedVersions("2.0", "1.9")).toBe(1);
	});

	it("treats missing components as zero", () => {
		expect(compareDottedVersions("1.0", "1.0.0")).toBe(0);
		expect(compareDottedVersions("1.0", "1.0.1")).toBe(-1);
	});

	it("rejects invalid version strings", () => {
		expect(() => compareDottedVersions("", "1.0")).toThrow();
		expect(() => compareDottedVersions("1.x", "1.0")).toThrow();
		expect(() => compareDottedVersions("-1.0", "1.0")).toThrow();
		expect(() => compareDottedVersions("1.0", "1.5.x")).toThrow();
	});
});

describe("assertVaultFormatSupported", () => {
	it("passes when vault format equals supported", () => {
		expect(() => assertVaultFormatSupported("1.0", "1.0")).not.toThrow();
	});

	it("passes when vault format is older", () => {
		expect(() => assertVaultFormatSupported("1.0", "1.1")).not.toThrow();
	});

	it("throws VaultFormatTooNew when vault is newer", () => {
		expect(() => assertVaultFormatSupported("2.0", "1.0")).toThrow(VaultFormatTooNew);
	});

	it("VaultFormatTooNew carries both versions", () => {
		try {
			assertVaultFormatSupported("2.0", "1.0");
			throw new Error("expected throw");
		} catch (e) {
			expect(e).toBeInstanceOf(VaultFormatTooNew);
			expect((e as VaultFormatTooNew).vaultFormat).toBe("2.0");
			expect((e as VaultFormatTooNew).supportedFormat).toBe("1.0");
		}
	});

	it("allows same-major future-minor (1.5 against 1.0) — preserve-and-ignore (Stage 10.8)", () => {
		expect(() => assertVaultFormatSupported("1.5", "1.0")).not.toThrow();
		expect(() => assertVaultFormatSupported("1.99", "1.0")).not.toThrow();
	});

	it("still rejects future-major (2.0 against 1.0)", () => {
		expect(() => assertVaultFormatSupported("2.0", "1.0")).toThrow(VaultFormatTooNew);
	});
});

describe("assertVaultFormatNotPreFreeze (Stage 10.8)", () => {
	it("passes when vault format equals the freeze", () => {
		expect(() => assertVaultFormatNotPreFreeze("1.0", "1.0")).not.toThrow();
	});

	it("passes when vault format is at or above the freeze", () => {
		expect(() => assertVaultFormatNotPreFreeze("1.5", "1.0")).not.toThrow();
		expect(() => assertVaultFormatNotPreFreeze("2.0", "1.0")).not.toThrow();
	});

	it("throws VaultFormatPreFreezeError when format is older than the freeze", () => {
		expect(() => assertVaultFormatNotPreFreeze("0.9", "1.0")).toThrow(VaultFormatPreFreezeError);
	});

	it("warns + opens when BRAINSTORM_ALLOW_PRE_FREEZE_VAULTS=1 (test-only)", () => {
		const previous = process.env.BRAINSTORM_ALLOW_PRE_FREEZE_VAULTS;
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		try {
			process.env.BRAINSTORM_ALLOW_PRE_FREEZE_VAULTS = "1";
			expect(() => assertVaultFormatNotPreFreeze("0.9", "1.0")).not.toThrow();
			expect(warn).toHaveBeenCalledWith(expect.stringMatching(/predates the 1\.0 freeze/));
		} finally {
			if (previous === undefined) {
				// biome-ignore lint/performance/noDelete: `delete` is the only way to truly unset an env var (assigning undefined coerces to the string "undefined")
				delete process.env.BRAINSTORM_ALLOW_PRE_FREEZE_VAULTS;
			} else process.env.BRAINSTORM_ALLOW_PRE_FREEZE_VAULTS = previous;
			warn.mockRestore();
		}
	});

	it("VaultFormatPreFreezeError carries both versions", () => {
		try {
			assertVaultFormatNotPreFreeze("0.9", "1.0");
			throw new Error("expected throw");
		} catch (e) {
			expect(e).toBeInstanceOf(VaultFormatPreFreezeError);
			expect((e as VaultFormatPreFreezeError).vaultFormat).toBe("0.9");
			expect((e as VaultFormatPreFreezeError).minimumFormat).toBe("1.0");
		}
	});
});

describe("runMigrations", () => {
	type Ctx = { applied: number[] };
	const mkMigration = (version: number): Migration<Ctx> => ({
		version,
		description: `migration ${version}`,
		up: (ctx) => {
			ctx.applied.push(version);
		},
	});

	it("applies migrations strictly greater than current up to target", async () => {
		const ctx: Ctx = { applied: [] };
		const migrations = [mkMigration(1), mkMigration(2), mkMigration(3)];
		const result = await runMigrations(0, 3, migrations, ctx);
		expect(ctx.applied).toEqual([1, 2, 3]);
		expect(result.from).toBe(0);
		expect(result.to).toBe(3);
		expect(result.applied.map((a) => a.version)).toEqual([1, 2, 3]);
	});

	it("skips migrations at or below current", async () => {
		const ctx: Ctx = { applied: [] };
		const migrations = [mkMigration(1), mkMigration(2), mkMigration(3)];
		await runMigrations(2, 3, migrations, ctx);
		expect(ctx.applied).toEqual([3]);
	});

	it("stops at target even if more migrations exist", async () => {
		const ctx: Ctx = { applied: [] };
		const migrations = [mkMigration(1), mkMigration(2), mkMigration(3)];
		const result = await runMigrations(0, 2, migrations, ctx);
		expect(ctx.applied).toEqual([1, 2]);
		expect(result.to).toBe(2);
	});

	it("is a no-op when current >= target", async () => {
		const ctx: Ctx = { applied: [] };
		const result = await runMigrations(3, 3, [mkMigration(1), mkMigration(2)], ctx);
		expect(ctx.applied).toEqual([]);
		expect(result.applied).toEqual([]);
	});

	it("refuses to migrate downward", async () => {
		await expect(runMigrations(5, 3, [], { applied: [] })).rejects.toThrow(/forward-only/);
	});

	it("rejects unordered migrations", async () => {
		const ctx: Ctx = { applied: [] };
		const bad = [mkMigration(2), mkMigration(1)];
		await expect(runMigrations(0, 2, bad, ctx)).rejects.toThrow(/strictly increasing/);
	});

	it("rejects duplicate version migrations", async () => {
		const ctx: Ctx = { applied: [] };
		const bad = [mkMigration(1), mkMigration(1)];
		await expect(runMigrations(0, 2, bad, ctx)).rejects.toThrow(/strictly increasing/);
	});

	it("rejects invalid current/target", async () => {
		await expect(runMigrations(-1, 0, [], { applied: [] })).rejects.toThrow(/Invalid current/);
		await expect(runMigrations(0, 1.5, [], { applied: [] })).rejects.toThrow(/Invalid target/);
	});

	it("rejects migrations with non-integer versions", async () => {
		const ctx: Ctx = { applied: [] };
		const bad: Migration<Ctx>[] = [
			{ version: 1.5, description: "x", up: () => undefined } as unknown as Migration<Ctx>,
		];
		await expect(runMigrations(0, 2, bad, ctx)).rejects.toThrow(/invalid version/);
	});

	it("supports async migrations", async () => {
		const ctx: Ctx = { applied: [] };
		const m: Migration<Ctx>[] = [
			{
				version: 1,
				description: "async",
				up: async (c) => {
					await Promise.resolve();
					c.applied.push(1);
				},
			},
		];
		await runMigrations(0, 1, m, ctx);
		expect(ctx.applied).toEqual([1]);
	});

	it("propagates errors from a migration", async () => {
		const ctx: Ctx = { applied: [] };
		const fail: Migration<Ctx>[] = [
			{
				version: 1,
				description: "ok",
				up: (c) => {
					c.applied.push(1);
				},
			},
			{
				version: 2,
				description: "fail",
				up: () => {
					throw new Error("boom");
				},
			},
			mkMigration(3),
		];
		await expect(runMigrations(0, 3, fail, ctx)).rejects.toThrow("boom");
		expect(ctx.applied).toEqual([1]);
	});

	it("records appliedAt as a millisecond timestamp", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-11T10:00:00Z"));
		const ctx: Ctx = { applied: [] };
		const result = await runMigrations(0, 1, [mkMigration(1)], ctx);
		expect(result.applied[0]?.appliedAt).toBe(Date.parse("2026-05-11T10:00:00Z"));
		vi.useRealTimers();
	});
});
