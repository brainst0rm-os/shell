/**
 * Corruption-recovery policy for the four domain SQLite databases — the
 * "Corrupted SQLite file" row of [
 * §Recovery scenarios] (iteration 12.8).
 *
 * Per the doc: *"rebuild from Yjs sources where possible (entities, search);
 * ledger/registry corruption is irrecoverable — user prompted to restore from
 * backup or re-init."* This module is the pure policy + error classifier;
 * `DataStores.open` consults it when an open/migrate hits a corrupt file.
 *
 * The policy honors doc 28's load-bearing decision *"recovery operations always
 * prompt before mutating"*: only the derived **search** index is auto-rebuilt
 * (it's a cache — losing it costs nothing but a re-index). Everything that could
 * hold authoritative data surfaces a `VaultCorruptionError` for the caller to
 * prompt on; nothing authoritative is ever silently destroyed.
 */

import type { DataStoreKind } from "./data-stores";

export enum CorruptionRecovery {
	/** Derived index (search.db / FTS5) — safe to drop + recreate empty; the
	 *  content re-indexes lazily from its sources. Auto-applied, no prompt. */
	RebuildDerived = "rebuild-derived",
	/** Recoverable from CRDT sources (entities.db ← Yjs), but the rebuild pass
	 *  + a "this rebuilds from your synced content" confirmation belong to the
	 *  caller (the Yjs→entities rebuild rides the 9.3.5 object-space model).
	 *  Never auto-destroyed — it may hold metadata not yet mirrored to Yjs. */
	PromptRebuildFromSources = "prompt-rebuild-from-sources",
	/** Authoritative + irrecoverable (ledger.db / registry.db) — only
	 *  restore-from-backup or re-init. Always prompts; never auto-mutated. */
	PromptRestoreOrReinit = "prompt-restore-or-reinit",
}

/** The recovery action for a corrupt domain DB. Total over `DataStoreKind`. */
export function recoveryForCorruptDb(kind: DataStoreKind): CorruptionRecovery {
	switch (kind) {
		case "search":
		// `settings` is per-device UI state; a corrupt file is archived +
		// recreated empty (prefs reset to defaults — never blocks vault open,
		// never prompts), same disposable posture as the derived search index.
		case "settings":
		// `cookies` is the per-device web jar (Browser-10); a corrupt file
		// just means re-login on next browse — archive + recreate empty,
		// never prompt, same disposable posture as the derived index.
		case "cookies":
		// `account` is the per-device cache of the control plane's plan +
		// entitlement (14.1); a corrupt file falls back to the hardcoded Free
		// entitlement and re-fetches on next sign-in — never blocks vault open,
		// same disposable posture as the derived index.
		case "account":
			return CorruptionRecovery.RebuildDerived;
		case "entities":
			return CorruptionRecovery.PromptRebuildFromSources;
		case "ledger":
		case "registry":
			return CorruptionRecovery.PromptRestoreOrReinit;
	}
}

/**
 * True when `error` indicates an unreadable / malformed database file (as
 * opposed to a transient open failure, a migration bug, or a logic error).
 * Matches the SQLite corruption codes + the canonical messages across drivers
 * (`better-sqlite3` and `bun:sqlite`): a wrong magic header (`SQLITE_NOTADB` /
 * "file is not a database"), page corruption (`SQLITE_CORRUPT` / "disk image is
 * malformed"), and the encrypted-or-garbage case.
 */
export function isCorruptionError(error: unknown): boolean {
	const code = (error as { code?: unknown } | null)?.code;
	if (code === "SQLITE_CORRUPT" || code === "SQLITE_NOTADB") return true;
	const message = error instanceof Error ? error.message : String(error);
	return /not a database|malformed|disk image|file is encrypted|database corruption/i.test(message);
}

/**
 * Thrown by `DataStores.open` when a domain DB is corrupt and the recovery
 * action is NOT an automatic rebuild — i.e. the caller must prompt the user
 * (restore from backup / re-init, or confirm a rebuild-from-sources). Carries
 * the corrupt `kind`, the `recovery` action, and the underlying driver error.
 */
export class VaultCorruptionError extends Error {
	readonly kind: DataStoreKind;
	readonly recovery: CorruptionRecovery;
	override readonly cause: unknown;

	constructor(kind: DataStoreKind, recovery: CorruptionRecovery, cause: unknown) {
		super(`vault database "${kind}" is corrupt (recovery: ${recovery})`);
		this.name = "VaultCorruptionError";
		this.kind = kind;
		this.recovery = recovery;
		this.cause = cause;
	}
}
