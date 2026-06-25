/**
 * Seeder → `entities.db` handoff.
 *
 * The BrainstormProject content seed runs out-of-process under Bun
 * (`tools/mcp-server/src/seed/seed-cli.ts`). Bun's sqlite has no SQLCipher,
 * so once the SQLCipher driver builds and a vault is encrypted at rest the
 * seeder can no longer open — let alone write — that vault's `entities.db`
 * (a plain open throws "file is not a database"). It still *computes* the
 * entity snapshot fine; it just can't be the one to write it.
 *
 * So the seeder hands the projected snapshot to the shell via a sidecar JSON
 * file under `<vault>/data/`. The shell — which holds the vault master key
 * and runs the SQLCipher driver under Electron — drains the sidecar and
 * applies it in-process through the session's already-decrypted
 * `EntitiesRepository`. `applySeederSnapshot` is the single upsert surface
 * both sides share: the seeder calls it directly on the rare unencrypted /
 * legacy vault, the shell calls it when draining the sidecar.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EntitiesRepository } from "../storage/entities-repo/entities-repo";
import type { VaultEntitiesSnapshot } from "./vault-entities-service";

/** Sidecar dropped by the seeder under `<vault>/data/` when it can't write
 *  the encrypted `entities.db` itself. The shell drains it on reseed / boot. */
export const SEED_SIDECAR_FILENAME = "seed-entities.json";

/** Provenance marker stamped into every seeded entity's properties so a
 *  later reseed can reconcile (delete) the seeded ids it no longer emits —
 *  without ever touching an entity created by hand in the app (those are
 *  never marked). Double-underscore signals an internal, non-app field; the
 *  app codecs read named fields and ignore it. Value is fixed so the marker
 *  is a pure presence test. */
export const SEED_PROVENANCE_KEY = "__seededBy";
export const SEED_PROVENANCE_VALUE = "brainstorm-seed";

/**
 * Legacy-orphan cleanup (one-time bridge for vaults seeded before the
 * provenance marker existed). The marker reconcile above can only remove
 * entities it has marked; orphans that accumulated under the old
 * purely-additive drain carry no marker, so they need an id-namespace sweep.
 *
 * Two safe classes, both restricted to entities that are NOT marked and NOT
 * in the current snapshot:
 *
 *  - `EXCLUSIVELY_SEEDED_TYPES` — object types the plan seeder is the *only*
 *    creator of (no app UI, no Welcome starter content, no IPC create path).
 *    Any such entity absent from the snapshot is, by construction, a seed
 *    orphan — type membership alone is sufficient.
 *  - `PREFIX_SCOPED_SEED_IDS` — types the Welcome seeder / apps *also* create
 *    (Task / Project / Section), so type is not enough. The plan seeder's ids
 *    are deterministic (`task-iter-…`, `proj-domain-…`, `sec-…`) and disjoint
 *    from Welcome (`welcome-…`), hand-made (`task-<uuid>`), and shell
 *    singletons (`brainstorm/root-folder/v1`) — so a prefix match cannot
 *    delete non-seed content.
 *
 * `dek_id` is deliberately NOT used as the discriminator: Welcome starter
 * content and the bench scratch note are created `dek_id: null` with these
 * same types, so a dek-based sweep would delete them.
 */
const EXCLUSIVELY_SEEDED_TYPES: ReadonlySet<string> = new Set([
	"brainstorm/Iteration/v1",
	"brainstorm/Stage/v1",
	"brainstorm/OpenQuestion/v1",
	"brainstorm/Milestone/v1",
	"brainstorm/Release/v1",
	"brainstorm/DesignDoc/v1",
	"brainstorm/CodeFile/v1",
]);

const PREFIX_SCOPED_SEED_IDS: ReadonlyArray<{ type: string; prefixes: readonly string[] }> = [
	// `iter-` is the pre-SH-37 Task id scheme (a Task once shared its source
	// iteration's id). Vaults seeded before that change still carry those rows;
	// they are seed-owned and must be sweepable. The prefix is type-scoped to
	// Task/v1 here, so it never matches an `Iteration/v1` entity (which legitimately
	// owns `iter-<code>`). A hand-made task is `task-<uuid>`, never `iter-`.
	{ type: "brainstorm/Task/v1", prefixes: ["task-iter-", "iter-"] },
	{ type: "brainstorm/Project/v1", prefixes: ["proj-domain-", "proj-app-", "proj-release"] },
	{ type: "brainstorm/Section/v1", prefixes: ["sec-"] },
];

export interface SeedWriteStats {
	entitiesCreated: number;
	entitiesUpdated: number;
	linksWritten: number;
	/** Previously-seeded entities removed because they dropped out of this
	 *  snapshot (a renamed / renumbered / deleted plan iteration). Counts both
	 *  the marker-scoped reconcile and the one-time legacy id-namespace sweep. */
	entitiesRemoved: number;
}

/**
 * Soft-delete legacy seed orphans (unmarked, pre-provenance-marker) that the
 * current snapshot no longer carries. Safe by construction — see the type/id
 * scoping rationale on `EXCLUSIVELY_SEEDED_TYPES` / `PREFIX_SCOPED_SEED_IDS`.
 * Idempotent: once a vault's orphans are swept (and current content is marked),
 * later applies find nothing. Caller runs this inside the apply transaction.
 */
function pruneLegacySeedOrphans(
	repo: EntitiesRepository,
	snapshotByType: ReadonlyMap<string, ReadonlySet<string>>,
	now: number,
): number {
	const targetTypes = [...EXCLUSIVELY_SEEDED_TYPES, ...PREFIX_SCOPED_SEED_IDS.map((p) => p.type)];
	const prefixesByType = new Map(PREFIX_SCOPED_SEED_IDS.map((p) => [p.type, p.prefixes]));
	let removed = 0;
	for (const entity of repo.query({ type: targetTypes })) {
		// Type-scoped membership: a stale `Task/iter-X` must NOT be shielded by a
		// snapshot `Iteration/iter-X` that shares its id (the SH-37 collision). An
		// entity is retained only when the snapshot carries this id FOR THIS TYPE.
		if (snapshotByType.get(entity.type)?.has(entity.id)) continue;
		if (entity.properties[SEED_PROVENANCE_KEY] === SEED_PROVENANCE_VALUE) continue;
		const qualifies =
			EXCLUSIVELY_SEEDED_TYPES.has(entity.type) ||
			(prefixesByType.get(entity.type)?.some((p) => entity.id.startsWith(p)) ?? false);
		if (qualifies && repo.softDelete(entity.id, now)) removed++;
	}
	return removed;
}

function sidecarPath(vaultPath: string): string {
	return join(vaultPath, "data", SEED_SIDECAR_FILENAME);
}

/**
 * Upsert a seeder snapshot into an open entities repo, then reconcile: any
 * previously-seeded entity that is NOT in this snapshot is soft-deleted, so a
 * reseed is authoritative rather than purely additive. Without this, a plan
 * iteration that gets renamed / renumbered / removed leaves its old Task (etc.)
 * entity — carrying a now-stale past due date — orphaned in `entities.db`
 * forever, accumulating across reseeds (overdue "ghost" tasks + inflated
 * counts). Reconciliation is scoped to the seed-provenance marker, so an
 * entity created by hand in the app is never marked and never removed.
 *
 * Idempotent modulo the `updated_at` bump. Wrapped in a single transaction so
 * a partial seed never lands and the removals are atomic with the upserts.
 */
export function applySeederSnapshot(
	repo: EntitiesRepository,
	snapshot: VaultEntitiesSnapshot,
	now: number,
): SeedWriteStats {
	let entitiesCreated = 0;
	let entitiesUpdated = 0;
	let linksWritten = 0;
	let entitiesRemoved = 0;
	const snapshotIds = new Set(snapshot.entities.map((e) => e.id));
	const snapshotByType = new Map<string, Set<string>>();
	for (const e of snapshot.entities) {
		let set = snapshotByType.get(e.type);
		if (!set) {
			set = new Set();
			snapshotByType.set(e.type, set);
		}
		set.add(e.id);
	}
	repo.transaction(() => {
		// Heal type collisions BEFORE upserting. A stale row sharing an id with a
		// snapshot entity of a DIFFERENT type — the SH-37 `Task/iter-X` vs
		// `Iteration/iter-X` collision — blocks the correct entity: `update` merges
		// properties without changing the row's type, so it stays the wrong type
		// forever and never re-anchors (the duplicate-overdue-task bug). Physically
		// remove it so the upsert below recreates it fresh with the right type.
		// Hand-made ids (`task-<uuid>`) never collide with deterministic seed ids.
		for (const entity of snapshot.entities) {
			const existing = repo.get(entity.id);
			if (existing && existing.type !== entity.type) {
				repo.softDelete(entity.id, now);
				repo.hardDelete(entity.id);
			}
		}
		for (const entity of snapshot.entities) {
			// Every seeded entity carries the provenance marker so a later
			// reseed can reconcile its own output (see below).
			const properties = { ...entity.properties, [SEED_PROVENANCE_KEY]: SEED_PROVENANCE_VALUE };
			// Three states for a seeded id: live → update in place; soft-deleted
			// (binned) → restore then overwrite (reseed is authoritative for its
			// own ids, and a raw INSERT would collide on the primary key since
			// `get`/`update` filter `deleted_at IS NULL` but the row physically
			// remains); genuinely absent → create.
			if (repo.get(entity.id) || repo.restore(entity.id, now)) {
				repo.update(entity.id, properties, now);
				entitiesUpdated++;
			} else {
				repo.create({
					id: entity.id,
					type: entity.type,
					spaceId: null,
					properties,
					createdBy: entity.ownerAppId ?? "io.brainstorm.shell",
					now: entity.createdAt ?? now,
					dekId: null,
				});
				entitiesCreated++;
			}
		}
		for (const link of snapshot.links) {
			repo.putLink({
				id: link.id,
				sourceEntityId: link.sourceEntityId,
				destEntityId: link.destEntityId,
				linkType: link.linkType,
				createdAt: link.createdAt ?? now,
			});
			linksWritten++;
		}
		// Reconcile: drop seed-marked entities the latest snapshot dropped.
		for (const id of repo.listIdsWithProperty(SEED_PROVENANCE_KEY, SEED_PROVENANCE_VALUE)) {
			if (snapshotIds.has(id)) continue;
			if (repo.softDelete(id, now)) entitiesRemoved++;
		}
		// One-time bridge: sweep pre-marker orphans the marker reconcile can't see.
		entitiesRemoved += pruneLegacySeedOrphans(repo, snapshotByType, now);
	});
	return { entitiesCreated, entitiesUpdated, linksWritten, entitiesRemoved };
}

/**
 * Persist a snapshot the seeder couldn't write itself (encrypted vault) so
 * the shell can apply it in-process. Overwrites any prior pending sidecar —
 * the latest seed wins.
 */
export async function writeSeedSidecar(
	vaultPath: string,
	snapshot: VaultEntitiesSnapshot,
): Promise<void> {
	await mkdir(join(vaultPath, "data"), { recursive: true });
	await writeFile(sidecarPath(vaultPath), JSON.stringify(snapshot), "utf8");
}

/**
 * Read a pending sidecar without removing it. Returns `null` when none is
 * present. The caller clears it (`clearSeedSidecar`) only after a successful
 * apply, so a failed apply leaves the snapshot on disk to retry on next boot
 * rather than silently losing it.
 */
export async function readSeedSidecar(vaultPath: string): Promise<VaultEntitiesSnapshot | null> {
	let raw: string;
	try {
		raw = await readFile(sidecarPath(vaultPath), "utf8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw err;
	}
	return JSON.parse(raw) as VaultEntitiesSnapshot;
}

/** Remove a drained sidecar so it isn't re-applied on the next boot. */
export async function clearSeedSidecar(vaultPath: string): Promise<void> {
	await rm(sidecarPath(vaultPath), { force: true });
}
