/**
 * Iteration 12.8 — corruption-recovery policy (doc 28 §Recovery, "Corrupted
 * SQLite file"). Pure tests for the per-DB recovery action, the corruption-error
 * classifier, and the typed error the open path throws when a prompt is needed.
 */

import { describe, expect, it } from "vitest";
import type { DataStoreKind } from "./data-stores";
import {
	CorruptionRecovery,
	VaultCorruptionError,
	isCorruptionError,
	recoveryForCorruptDb,
} from "./recovery-plan";

describe("recoveryForCorruptDb", () => {
	it("auto-rebuilds the derived search index", () => {
		expect(recoveryForCorruptDb("search")).toBe(CorruptionRecovery.RebuildDerived);
	});

	it("prompts to rebuild entities from sources (never auto-destroyed)", () => {
		expect(recoveryForCorruptDb("entities")).toBe(CorruptionRecovery.PromptRebuildFromSources);
	});

	it("treats ledger + registry as irrecoverable → prompt restore/re-init", () => {
		expect(recoveryForCorruptDb("ledger")).toBe(CorruptionRecovery.PromptRestoreOrReinit);
		expect(recoveryForCorruptDb("registry")).toBe(CorruptionRecovery.PromptRestoreOrReinit);
	});

	it("covers every DataStoreKind (no default-fallthrough)", () => {
		const kinds: DataStoreKind[] = ["ledger", "registry", "entities", "search"];
		for (const kind of kinds) {
			expect(Object.values(CorruptionRecovery)).toContain(recoveryForCorruptDb(kind));
		}
	});
});

describe("isCorruptionError", () => {
	it("matches SQLite corruption codes", () => {
		expect(isCorruptionError({ code: "SQLITE_CORRUPT" })).toBe(true);
		expect(isCorruptionError({ code: "SQLITE_NOTADB" })).toBe(true);
	});

	it("matches the canonical driver messages", () => {
		for (const message of [
			"file is not a database",
			"database disk image is malformed",
			"file is encrypted or is not a database",
			"SqliteError: database corruption at line 1",
		]) {
			expect(isCorruptionError(new Error(message))).toBe(true);
		}
	});

	it("does NOT match transient / logic errors", () => {
		expect(isCorruptionError(new Error("unable to open database file"))).toBe(false);
		expect(isCorruptionError(new Error("no such table: capabilities"))).toBe(false);
		expect(isCorruptionError(new Error("SQLITE_BUSY: database is locked"))).toBe(false);
		expect(isCorruptionError(null)).toBe(false);
		expect(isCorruptionError("nope")).toBe(false);
	});
});

describe("VaultCorruptionError", () => {
	it("carries the kind, recovery action, and underlying cause", () => {
		const cause = new Error("file is not a database");
		const err = new VaultCorruptionError("ledger", CorruptionRecovery.PromptRestoreOrReinit, cause);
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe("VaultCorruptionError");
		expect(err.kind).toBe("ledger");
		expect(err.recovery).toBe(CorruptionRecovery.PromptRestoreOrReinit);
		expect(err.cause).toBe(cause);
		expect(err.message).toContain("ledger");
	});
});
