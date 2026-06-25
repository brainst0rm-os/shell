/**
 * Pure helper for inserting a `TaskEmbedNode`.
 *
 * The `/task` slash command routes through `task-embed-picker-plugin`,
 * where the editor + the host paragraph key are known. Keeping the editor
 * mutation in a pure helper lets the picker UI and the slash wiring be
 * tested without a DOM (mirrors Notes' `applyEmbedInsertion`).
 *
 * The helper *replaces* the target paragraph (the now-empty `/<query>` row
 * the slash menu left behind). A missing / stale key falls back to a
 * root-append so the embed never silently drops.
 */

import { $getNodeByKey, $getRoot, $isElementNode, type LexicalEditor, type NodeKey } from "lexical";
import { $createTaskEmbedNode } from "./task-embed-node";

export type TaskEmbedInsertion = {
	entityId: string;
	entityType: string;
	label: string;
	/** Block id resolved by the caller from `services.blocks.forType(type)`
	 *  (the providing app's live block), falling back to the generic shell
	 *  entity-card when omitted. */
	blockId?: string;
};

export function applyTaskEmbedInsertion(
	editor: LexicalEditor,
	paragraphKey: NodeKey | null,
	insertion: TaskEmbedInsertion,
): void {
	editor.update(
		() => {
			const embed = insertion.blockId
				? $createTaskEmbedNode(
						insertion.entityId,
						insertion.entityType,
						insertion.label,
						insertion.blockId,
					)
				: $createTaskEmbedNode(insertion.entityId, insertion.entityType, insertion.label);
			const target = paragraphKey ? $getNodeByKey(paragraphKey) : null;
			if (target && $isElementNode(target)) {
				target.replace(embed);
				return;
			}
			$getRoot().append(embed);
		},
		{ discrete: true },
	);
}
