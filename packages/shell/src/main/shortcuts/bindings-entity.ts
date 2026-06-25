/**
 * `bindings-entity.ts` — the `brainstorm/ShortcutBindings/v1` entity type
 * and the one-shot, idempotent, boot-independent migration of the legacy
 * flat `<vault>/shell/shortcut-bindings.json` file into `entities.db`.
 *
 * Per §"Shortcut bindings as a personal
 * entity": user customizations live as a single `user`-scoped
 * `brainstorm/ShortcutBindings/v1` entity. Stage 6 shipped the shape +
 * file-backed store; **this is the Stage 9 migration** the plan promised:
 * a one-shot read-and-store with **no shape change** — the file's
 * `{ version, overrides: [{ id, chord }] }` body becomes the entity's
 * `properties` byte-for-byte.
 *
 * Guarantees:
 *  - **Idempotent.** Keyed on the fixed singleton entity id
 *    (`SHORTCUT_BINDINGS_ENTITY_ID`). A second run (next boot) finds the
 *    row present and is a no-op.
 *  - **No-clobber.** A row already in `entities.db` is NEVER overwritten —
 *    `entities.db` is authoritative (it may carry a newer rebind made
 *    through the registry after the first migration). Only a *missing* id
 *    is created.
 *  - **Boot-independent.** Driven by `onActiveVaultSessionChanged` in the
 *    shell, exactly like the kv backfill / search-indexer swap — works in
 *    production, with zero dev seeders, on the very first open.
 *  - **Non-destructive.** The flat file is never deleted; it stays as the
 *    migration source / older-shell fallback.
 *  - **Fault-isolated.** A storage error logs and the migration bails; it
 *    never throws into the session-open path.
 *
 * Pure I/O + repo calls — fully testable under Bun.
 */

import type { EntitiesRepository } from "../storage/entities-repo/entities-repo";
import { type BindingOverride, type BindingsFile, readBindings } from "./bindings-store";

/** Reverse-DNS entity type per. */
export const SHORTCUT_BINDINGS_TYPE = "brainstorm/ShortcutBindings/v1" as const;

/** Singleton-per-vault entity id. Fixed (not random) so idempotence /
 *  no-clobber are keyed on a stable id exactly like the kv backfill. */
export const SHORTCUT_BINDINGS_ENTITY_ID = "brainstorm:shortcut-bindings" as const;

/** Shell-owned `createdBy`. The shortcut store is shell-side; no app
 *  introduces or owns this type (consistent with the kv-backfilled
 *  shell-introduced types — not registered into the app entity_types
 *  registry, the `type` string is opaque per OQ-7). */
export const SHORTCUT_BINDINGS_OWNER = "io.brainstorm.shell" as const;

/** Binding-scope kinds per §"Shortcut bindings as a personal
 *  entity". Personal-by-default; `org` is a v2 addition. Enum, not a raw
 *  literal, per the project discriminator convention. */
export enum ShortcutBindingsScopeKind {
	User = "user",
}

/**
 * The entity `properties` blob. **Byte-identical superset of the flat
 * file's body** — `version` + `overrides` are carried through unchanged
 * (no shape migration, only a storage-substrate migration); `scope` is the
 * doc-specified personal-by-default envelope. A reader that only cares
 * about overrides sees the exact same `{ id, chord }[]` it read from disk.
 */
export type ShortcutBindingsProperties = {
	version: BindingsFile["version"];
	overrides: BindingOverride[];
	scope: { kind: ShortcutBindingsScopeKind };
};

export type ShortcutBindingsMigrationResult = {
	migrated: boolean;
	/** Present when the row already existed (no-clobber) or no file. */
	reason?: "already-present" | "no-overrides";
};

function toProperties(file: BindingsFile): ShortcutBindingsProperties {
	return {
		version: file.version,
		overrides: [...file.overrides],
		scope: { kind: ShortcutBindingsScopeKind.User },
	};
}

/** Read the overrides back out of a stored entity row's properties,
 *  tolerating an absent / malformed blob (returns `[]`). This is the
 *  single decode point the registry-load path uses. */
export function overridesFromEntityProperties(
	properties: Record<string, unknown> | null | undefined,
): BindingOverride[] {
	const raw = properties?.overrides;
	if (!Array.isArray(raw)) return [];
	const out: BindingOverride[] = [];
	for (const value of raw) {
		if (!value || typeof value !== "object") continue;
		const o = value as Partial<BindingOverride>;
		if (typeof o.id !== "string" || o.id.length === 0) continue;
		if (o.chord !== null && typeof o.chord !== "string") continue;
		out.push({ id: o.id, chord: o.chord });
	}
	return out;
}

/**
 * One-shot migration: if the flat file carries overrides and the entity
 * does not yet exist, read-and-store it into `entities.db`. Idempotent,
 * no-clobber, non-destructive. Never rejects the vault-open path.
 */
export async function migrateBindingsFileToEntity(
	vaultPath: string,
	repo: EntitiesRepository,
	now: number = Date.now(),
): Promise<ShortcutBindingsMigrationResult> {
	let file: BindingsFile;
	try {
		file = await readBindings(vaultPath);
	} catch (error) {
		console.error(`[shortcut-bindings-migration] read failed, skipping: ${(error as Error).message}`);
		return { migrated: false };
	}

	// No-clobber: an existing row is authoritative (it may carry a rebind
	// made through the registry after the first migration). Only ever ADD
	// a missing id.
	try {
		if (repo.get(SHORTCUT_BINDINGS_ENTITY_ID)) {
			return { migrated: false, reason: "already-present" };
		}
	} catch (error) {
		console.error(
			`[shortcut-bindings-migration] entity probe failed, skipping: ${(error as Error).message}`,
		);
		return { migrated: false };
	}

	// A fresh vault (no file / no overrides) just has no custom bindings —
	// defaults apply. Don't create an empty row (the entity is created
	// lazily per §"Storage and sync"); the registry save path
	// creates it on the first rebind.
	if (file.overrides.length === 0) {
		return { migrated: false, reason: "no-overrides" };
	}

	try {
		repo.create({
			id: SHORTCUT_BINDINGS_ENTITY_ID,
			type: SHORTCUT_BINDINGS_TYPE,
			properties: toProperties(file),
			createdBy: SHORTCUT_BINDINGS_OWNER,
			now,
			// Shell-internal singleton — no per-entity DEK (Stage 10.1).
			dekId: null,
		});
	} catch (error) {
		console.error(`[shortcut-bindings-migration] create failed: ${(error as Error).message}`);
		return { migrated: false };
	}

	return { migrated: true };
}

/**
 * Read the user's effective overrides from the entity-backed store, with
 * the flat file as the migration source / older-shell fallback (never
 * silently lost). The entity is authoritative when present.
 */
export function readOverridesFromEntity(repo: EntitiesRepository): BindingOverride[] {
	try {
		const row = repo.get(SHORTCUT_BINDINGS_ENTITY_ID);
		if (!row) return [];
		return overridesFromEntityProperties(row.properties);
	} catch (error) {
		console.error(
			`[shortcut-bindings] entity read failed, treating as no overrides: ${(error as Error).message}`,
		);
		return [];
	}
}

/**
 * Persist the user's overrides to the entity-backed store. Creates the
 * singleton row lazily on the first rebind, updates it thereafter. The
 * flat file is intentionally NOT touched — `entities.db` is authoritative
 * going forward; the file remains the migration source only.
 */
export function writeOverridesToEntity(
	repo: EntitiesRepository,
	overrides: ReadonlyArray<BindingOverride>,
	now: number = Date.now(),
): void {
	const properties: ShortcutBindingsProperties = {
		version: 1,
		overrides: [...overrides],
		scope: { kind: ShortcutBindingsScopeKind.User },
	};
	try {
		if (repo.get(SHORTCUT_BINDINGS_ENTITY_ID)) {
			repo.update(SHORTCUT_BINDINGS_ENTITY_ID, properties, now);
			return;
		}
		repo.create({
			id: SHORTCUT_BINDINGS_ENTITY_ID,
			type: SHORTCUT_BINDINGS_TYPE,
			properties,
			createdBy: SHORTCUT_BINDINGS_OWNER,
			now,
			// Shell-internal singleton — no per-entity DEK (Stage 10.1).
			dekId: null,
		});
	} catch (error) {
		console.error(`[shortcut-bindings] entity write failed: ${(error as Error).message}`);
	}
}
