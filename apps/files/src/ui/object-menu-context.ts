/**
 * `filesObjectMenuContext` — the single place Files builds the shared
 * cross-app object menu's context for one of its objects (a folder or a
 * file). Every per-object surface (each content-list row, the header's
 * current-folder breadcrumb) goes through this so they all offer the
 * *same* Open / Pin·Unpin → Rename / Duplicate / Edit icon / Edit cover →
 * Remove in the same order with the same labels — the menu itself is
 * rendered by the shared SDK chrome, never a hand-rolled popup.
 *
 * The SDK's `<ObjectMenuTrigger context>` resolves this lazily at open
 * time and pre-fetches the pin state itself; this helper only assembles
 * the descriptor. Returning `null` makes the trigger inert (e.g. before
 * the entity exists).
 */

import { IconName } from "@brainstorm/sdk/icon";
import type { ObjectMenuExtraItem } from "@brainstorm/sdk/object-menu";
import type { OpenObjectMenuOptions } from "@brainstorm/sdk/object-menu";
import { t } from "../i18n";
import { SelectionModifier } from "../logic/selection";
import type { FilesStore } from "../store/use-files-store";
import { type Entity, FOLDER_TYPE, readName } from "../types/entity";
import type { BrainstormRuntime } from "../types/runtime";

export type FilesObjectMenuInput = {
	entity: Entity;
	store: FilesStore;
	runtime: BrainstormRuntime | undefined;
	onEditIcon: (folderId: string) => void;
	onEditCover: (folderId: string) => void;
};

/** App-owned extra items (between Pin and Remove): Rename / Duplicate and,
 *  for folders, Edit icon / Edit cover. Shared by every Files object
 *  surface so the row and the header header never drift. */
function filesExtraItems({
	entity,
	store,
	onEditIcon,
	onEditCover,
}: FilesObjectMenuInput): ObjectMenuExtraItem[] {
	const isFolder = entity.type === FOLDER_TYPE;
	return [
		{
			id: "rename",
			label: t("brainstorm.files.menu.rename"),
			icon: IconName.Pencil,
			run: () => {
				store.selectRow(entity.id, SelectionModifier.None);
				store.startRenameOnAnchor();
			},
		},
		{
			id: "duplicate",
			label: t("brainstorm.files.menu.duplicate"),
			icon: IconName.Copy,
			run: () => store.duplicateIds([entity.id]),
		},
		...(isFolder
			? [
					{
						id: "edit-icon",
						label: t("brainstorm.files.appearance.editIcon"),
						icon: IconName.Pencil,
						run: () => {
							store.selectRow(entity.id, SelectionModifier.None);
							onEditIcon(entity.id);
						},
					},
					{
						id: "edit-cover",
						label: t("brainstorm.files.appearance.editCover"),
						icon: IconName.Palette,
						run: () => {
							store.selectRow(entity.id, SelectionModifier.None);
							onEditCover(entity.id);
						},
					},
				]
			: []),
	];
}

export function filesObjectMenuContext(input: FilesObjectMenuInput): OpenObjectMenuOptions {
	const { entity, store, runtime } = input;
	return {
		target: { entityId: entity.id, entityType: entity.type, label: readName(entity) },
		runtime: runtime ?? null,
		labels: {
			open: t("brainstorm.files.menu.open"),
			openWith: t("brainstorm.files.menu.openWith"),
			pin: t("brainstorm.files.menu.pin"),
			unpin: t("brainstorm.files.menu.unpin"),
			remove: t("brainstorm.files.menu.remove"),
		},
		extraItems: filesExtraItems(input),
		onRemove: () => store.deleteIds([entity.id]),
	};
}
