/**
 * MediaDropPlugin — intercept image/video/audio/file drops onto the
 * editor or pastes from the clipboard. Uploads via the host uploader
 * and inserts the matching block at the drop / caret position.
 *
 * Lexical command priorities matter here:
 *   - `DRAGOVER_COMMAND` — return `true` (consume) when the dataTransfer
 *     carries files, so the browser shows the drop affordance.
 *   - `DROP_COMMAND` — return `true` only when we matched media files
 *     (otherwise let Lexical's default text-drop fire).
 *   - `PASTE_COMMAND` — same gating. Paste of plain text or our own
 *     block-clipboard payload falls through; only paste of media files
 *     is intercepted here.
 *
 * Images fall through `resolveImageSrc` (which tries the host uploader
 * and falls back to a 2 MiB-capped inline data URL); videos go straight
 * to `tryUploadFile` (data URLs are impractical for video sizes).
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
	$getRoot,
	$getSelection,
	$isRangeSelection,
	COMMAND_PRIORITY_HIGH,
	DRAGOVER_COMMAND,
	DROP_COMMAND,
	type LexicalEditor,
	type LexicalNode,
	PASTE_COMMAND,
} from "lexical";
import { useEffect } from "react";
import {
	MediaFileKind,
	classifyMediaFile,
	collectMediaFiles,
	dataTransferHasFiles,
	resolveBinarySrc,
	resolveImageSrc,
	tryUploadFile,
} from "../media-upload";
import { $createAudioBlockNode } from "../nodes/audio-block-node";
import { $createFileBlockNode } from "../nodes/file-block-node";
import { $createImageBlockNode } from "../nodes/image-block-node";
import { $createVideoBlockNode } from "../nodes/video-block-node";

export function MediaDropPlugin() {
	const [editor] = useLexicalComposerContext();

	useEffect(() => {
		const removeDragover = editor.registerCommand(
			DRAGOVER_COMMAND,
			(event) => {
				if (!dataTransferHasFiles(event.dataTransfer)) return false;
				event.preventDefault();
				return true;
			},
			COMMAND_PRIORITY_HIGH,
		);

		const removeDrop = editor.registerCommand(
			DROP_COMMAND,
			(event) => {
				const files = collectMediaFiles(event.dataTransfer?.files);
				if (files.length === 0) return false;
				event.preventDefault();
				void insertMediaFiles(editor, files);
				return true;
			},
			COMMAND_PRIORITY_HIGH,
		);

		const removePaste = editor.registerCommand(
			PASTE_COMMAND,
			(event) => {
				if (!(event instanceof ClipboardEvent)) return false;
				const files = collectMediaFiles(event.clipboardData?.files);
				if (files.length === 0) return false;
				event.preventDefault();
				void insertMediaFiles(editor, files);
				return true;
			},
			COMMAND_PRIORITY_HIGH,
		);

		return () => {
			removeDragover();
			removeDrop();
			removePaste();
		};
	}, [editor]);

	return null;
}

async function insertMediaFiles(editor: LexicalEditor, files: readonly File[]): Promise<void> {
	for (const file of files) {
		const kind = classifyMediaFile(file);
		const src =
			kind === MediaFileKind.Image
				? await resolveImageSrc(file)
				: kind === MediaFileKind.Video
					? await tryUploadFile(file)
					: await resolveBinarySrc(file);
		if (!src) continue;
		editor.update(
			() => {
				const block =
					kind === MediaFileKind.Image
						? $createImageBlockNode(src, file.name)
						: kind === MediaFileKind.Video
							? $createVideoBlockNode(src, file.type)
							: kind === MediaFileKind.Audio
								? $createAudioBlockNode(src, file.type, file.name)
								: $createFileBlockNode(src, file.name, file.size, file.type);
				const sel = $getSelection();
				let inserted = false;
				if ($isRangeSelection(sel)) {
					try {
						const top = sel.anchor.getNode().getTopLevelElementOrThrow();
						top.insertAfter(block);
						inserted = true;
					} catch {
						// fall through — root append below
					}
				}
				if (!inserted) {
					const last = $getRoot().getLastChild() as LexicalNode | null;
					if (last) last.insertAfter(block);
					else $getRoot().append(block);
				}
			},
			{ discrete: true },
		);
	}
}
