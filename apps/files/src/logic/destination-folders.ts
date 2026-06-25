/**
 * Destination-folder candidates for the bulk Move/Copy picker (9.8.12): the
 * full folder tree, preorder + depth-labelled (the picker indents by level),
 * with the moving items themselves AND their whole subtrees excluded — you
 * can't move a folder into itself or a descendant (`tree.move`'s cycle guard
 * is the backstop; the picker just never offers the invalid rows).
 */

import { FOLDER_TYPE, ROOT_FOLDER_ID, readName } from "../types/entity";
import type { Entity } from "../types/entity";

/** The structural slice of `FolderTree` the walk needs — fakeable in tests. */
export type FolderTreeLike = {
	get(id: string): Entity | undefined;
	listChildFolders(folderId: string): Entity[];
};

export type DestinationFolder = {
	id: string;
	name: string;
	level: number;
};

export function destinationFolders(
	tree: FolderTreeLike,
	excludeIds: ReadonlySet<string>,
): DestinationFolder[] {
	const out: DestinationFolder[] = [];
	const walk = (id: string, level: number): void => {
		if (excludeIds.has(id)) return;
		const entity = tree.get(id);
		if (!entity || entity.type !== FOLDER_TYPE) return;
		out.push({ id, name: readName(entity), level });
		for (const child of tree.listChildFolders(id)) walk(child.id, level + 1);
	};
	walk(ROOT_FOLDER_ID, 0);
	return out;
}
