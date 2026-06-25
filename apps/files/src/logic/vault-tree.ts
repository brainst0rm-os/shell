/**
 * Build the Files tree from a real vault snapshot — the long-term
 * keystone behind "manage the files in your vault" (the Database
 * 9.12.2-read-half move, applied to Files).
 *
 * Until this iteration the renderer flattened *every* entity as a direct
 * member of one synthetic `(vault)` root, ignoring real `brainstorm/Folder/v1`
 * entities entirely. This respects folder membership: a `Folder/v1`'s
 * `members` define its children (folders nest); any entity no folder
 * contains surfaces at the synthetic root so nothing is unreachable.
 *
 * Pure + deterministic — it survives the swap from the `vaultEntities`
 * preview aggregator to the real entities service (9.3) and the Files
 * host service (9.10, binary file *content*); only the snapshot source
 * changes, never this projection.
 */

import { type Entity, FILE_TYPE, FOLDER_TYPE } from "../types/entity";

export type VaultEntityInput = {
	id: string;
	type: string;
	properties: Record<string, unknown>;
	createdAt: number;
	updatedAt: number;
	deletedAt: number | null;
};

function displayName(properties: Record<string, unknown>): string {
	const value = properties.name ?? properties.title;
	return typeof value === "string" && value.length > 0 ? value : "(untitled)";
}

/**
 * @param entities raw vault snapshot rows (soft-deleted dropped here)
 * @param rootId   the well-known root Folder id the renderer navigates to
 *                 (`ROOT_FOLDER_ID` — shell-bootstrapped via
 *                 `VaultSession.ensureRootFolder`)
 * @returns `[root, ...entities]`. When the snapshot contains the real
 *          `rootId` Folder (the shell bootstrap ran) its OWN row is the
 *          root — its declared members first, then any orphan no folder
 *          contains, so nothing is unreachable and folder
 *          appearance/pinning/open address the durable entity. When it is
 *          absent (older vault / bootstrap not yet run) a synthetic root
 *          is used so the app degrades gracefully. Empty `root.members`
 *          means an honest empty vault — never demo data.
 */
export function buildVaultFileTree(
	entities: readonly VaultEntityInput[],
	rootId: string,
	now: number = Date.now(),
): Entity[] {
	// Files manages only files and folders — the vault snapshot is the whole
	// shared object space (notes, tasks, bookmarks, journal entries, …), so we
	// scope to File/Folder rows here. Member refs that pointed at a now-excluded
	// entity are dropped by the dangling-ref sanitiser below (it keys off the
	// filtered `liveIds`), so nothing non-file can surface as a ghost row.
	const live = entities.filter(
		(e) => e.deletedAt == null && (e.type === FILE_TYPE || e.type === FOLDER_TYPE),
	);
	const liveIds = new Set(live.map((e) => e.id));
	const rootRow = live.find((e) => e.id === rootId && e.type === FOLDER_TYPE);
	const nonRoot = live.filter((e) => e.id !== rootId);

	// Sanitised member lists per real folder: keep only ids that point at a
	// live, non-self, non-root entity (drops dangling refs so no ghost rows
	// render; the root is the container, never another folder's member).
	const folderMembers = new Map<string, string[]>();
	const contained = new Set<string>();
	for (const e of nonRoot) {
		if (e.type !== FOLDER_TYPE) continue;
		const raw = e.properties.members;
		const declared = Array.isArray(raw) ? raw.filter((m): m is string => typeof m === "string") : [];
		const members: string[] = [];
		for (const m of declared) {
			if (m === e.id || m === rootId || !liveIds.has(m) || members.includes(m)) continue;
			members.push(m);
			contained.add(m);
		}
		folderMembers.set(e.id, members);
	}

	const mapped: Entity[] = nonRoot.map((e) => {
		const base = {
			id: e.id,
			type: e.type,
			createdAt: e.createdAt,
			updatedAt: e.updatedAt,
			deletedAt: null,
		};
		if (e.type === FOLDER_TYPE) {
			return {
				...base,
				properties: {
					...e.properties,
					name: displayName(e.properties),
					members: folderMembers.get(e.id) ?? [],
				},
			};
		}
		return { ...base, properties: { ...e.properties, name: displayName(e.properties) } };
	});

	// The root's declared members (if it carries any) come first, in
	// declared order; then every orphan no folder contains, folders before
	// files for a file-manager-natural order. This keeps the root
	// authoritative while never stranding an entity.
	const rootDeclared: string[] = [];
	const rootDeclaredSet = new Set<string>();
	const rawRootMembers = rootRow?.properties.members;
	if (Array.isArray(rawRootMembers)) {
		for (const m of rawRootMembers) {
			if (typeof m !== "string" || m === rootId || !liveIds.has(m) || rootDeclaredSet.has(m)) {
				continue;
			}
			rootDeclared.push(m);
			rootDeclaredSet.add(m);
			contained.add(m);
		}
	}
	const topFolders = mapped
		.filter((e) => e.type === FOLDER_TYPE && !contained.has(e.id))
		.map((e) => e.id);
	const topOthers = mapped
		.filter((e) => e.type !== FOLDER_TYPE && !contained.has(e.id))
		.map((e) => e.id);
	const rootMembers = [...rootDeclared, ...topFolders, ...topOthers];

	const root: Entity = rootRow
		? {
				id: rootId,
				type: FOLDER_TYPE,
				properties: {
					...rootRow.properties,
					name: displayName(rootRow.properties),
					members: rootMembers,
				},
				createdAt: rootRow.createdAt,
				updatedAt: rootRow.updatedAt,
				deletedAt: null,
			}
		: {
				id: rootId,
				type: FOLDER_TYPE,
				properties: { name: "Vault", members: rootMembers },
				createdAt: now,
				updatedAt: now,
				deletedAt: null,
			};
	return [root, ...mapped];
}
