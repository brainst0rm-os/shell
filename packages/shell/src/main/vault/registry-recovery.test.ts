/**
 * Iteration 12.8 — recovery-scenario coverage for the "Vault registry corrupted"
 * row of §Recovery scenarios:
 * rebuild the vault list by scanning standard locations + known paths, offering
 * the found vaults back to the user. The scan is read-only (prompt-before-mutate
 * decision), so these tests assert it never writes — they exercise the pure core
 * with injected directory-listing + vault.json readers.
 */

import { describe, expect, it, vi } from "vitest";
import { scanForVaults, vaultEntryFromVaultJson } from "./registry-recovery";

const vaultJson = (over: Record<string, unknown> = {}) => ({
	id: "v-1",
	name: "My Vault",
	color: "#6366f1",
	format: "1.0",
	createdAt: 1_700_000_000_000,
	...over,
});

describe("vaultEntryFromVaultJson", () => {
	it("maps a valid vault.json to a registry entry", () => {
		const entry = vaultEntryFromVaultJson("/vaults/a", vaultJson({ icon: "🧠" }));
		expect(entry).toEqual({
			id: "v-1",
			name: "My Vault",
			color: "#6366f1",
			icon: "🧠",
			path: "/vaults/a",
			lastOpenedAt: 1_700_000_000_000,
			format: "1.0",
		});
	});

	it("omits icon when absent and falls back lastOpenedAt to 0 without createdAt", () => {
		const entry = vaultEntryFromVaultJson("/vaults/a", vaultJson({ createdAt: undefined }));
		expect(entry).not.toHaveProperty("icon");
		expect(entry?.lastOpenedAt).toBe(0);
	});

	it("returns null for non-vault JSON (missing required fields)", () => {
		expect(vaultEntryFromVaultJson("/x", { id: "v", name: "n" })).toBeNull();
		expect(vaultEntryFromVaultJson("/x", null)).toBeNull();
		expect(vaultEntryFromVaultJson("/x", "nope")).toBeNull();
	});
});

describe("scanForVaults (registry rebuild-by-scan)", () => {
	it("finds vaults in subdirectories of the standard root", async () => {
		const disk: Record<string, unknown> = {
			"/Docs/Brainstorm/Work": vaultJson({ id: "work", name: "Work" }),
			"/Docs/Brainstorm/Personal": vaultJson({ id: "personal", name: "Personal" }),
		};
		const found = await scanForVaults({
			scanRoots: ["/Docs/Brainstorm"],
			knownPaths: [],
			listSubdirs: async () => Object.keys(disk),
			readVaultJson: async (p) => disk[p] ?? null,
		});
		expect(found.map((v) => v.id).sort()).toEqual(["personal", "work"]);
		expect(found.map((v) => v.path)).toContain("/Docs/Brainstorm/Work");
	});

	it("checks known paths directly (salvaged registry entries) even outside the scan root", async () => {
		const disk: Record<string, unknown> = {
			"/elsewhere/Archive": vaultJson({ id: "archive", name: "Archive" }),
		};
		const found = await scanForVaults({
			scanRoots: ["/Docs/Brainstorm"],
			knownPaths: ["/elsewhere/Archive"],
			listSubdirs: async () => [],
			readVaultJson: async (p) => disk[p] ?? null,
		});
		expect(found).toHaveLength(1);
		expect(found[0]?.id).toBe("archive");
	});

	it("dedupes by vault id; a known-path entry wins over a re-scan of the same vault", async () => {
		const known = vaultJson({ id: "dup", name: "Known" });
		const scanned = vaultJson({ id: "dup", name: "Scanned" });
		const found = await scanForVaults({
			scanRoots: ["/Docs/Brainstorm"],
			knownPaths: ["/known/dup"],
			listSubdirs: async () => ["/Docs/Brainstorm/dup"],
			readVaultJson: async (p) => (p === "/known/dup" ? known : scanned),
		});
		expect(found).toHaveLength(1);
		expect(found[0]?.name).toBe("Known");
		expect(found[0]?.path).toBe("/known/dup");
	});

	it("skips directories without a valid vault.json", async () => {
		const disk: Record<string, unknown> = {
			"/Docs/Brainstorm/RealVault": vaultJson({ id: "real" }),
			"/Docs/Brainstorm/NotAVault": { some: "other-folder" },
			"/Docs/Brainstorm/Empty": null,
		};
		const found = await scanForVaults({
			scanRoots: ["/Docs/Brainstorm"],
			knownPaths: [],
			listSubdirs: async () => Object.keys(disk),
			readVaultJson: async (p) => disk[p] ?? null,
		});
		expect(found.map((v) => v.id)).toEqual(["real"]);
	});

	it("is best-effort: an unreadable scan root or vault.json read is skipped, never thrown", async () => {
		const found = await scanForVaults({
			scanRoots: ["/missing-root", "/Docs/Brainstorm"],
			knownPaths: ["/known/explodes"],
			listSubdirs: async (dir) => {
				if (dir === "/missing-root") throw new Error("ENOENT");
				return ["/Docs/Brainstorm/Good"];
			},
			readVaultJson: async (p) => {
				if (p === "/known/explodes") throw new Error("EACCES");
				if (p === "/Docs/Brainstorm/Good") return vaultJson({ id: "good" });
				return null;
			},
		});
		expect(found.map((v) => v.id)).toEqual(["good"]);
	});

	it("returns an empty list when nothing on disk is a vault (no throw, no mutation)", async () => {
		const listSubdirs = vi.fn(async () => ["/Docs/Brainstorm/x"]);
		const readVaultJson = vi.fn(async () => null);
		const found = await scanForVaults({
			scanRoots: ["/Docs/Brainstorm"],
			knownPaths: [],
			listSubdirs,
			readVaultJson,
		});
		expect(found).toEqual([]);
	});
});
