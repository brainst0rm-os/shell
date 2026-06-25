/**
 * The shared media block-command catalogue — the `/image` `/video`
 * `/audio` `/file` slash commands every full-editor surface gets. Each
 * opens a native file picker, uploads through the host uploader
 * (`getEditorHost().uploadFile`, wired per app at boot), and inserts the
 * matching media block at the caret.
 *
 * Built from an `EditorT` (not hard-coded strings) so a host locale flips
 * the labels via `<BrainstormEditor i18nOverrides>`, mirroring
 * `createStandardBlockCommands`.
 */

import { $getRoot, $getSelection, $isRangeSelection, type LexicalEditor } from "lexical";
import { type BlockCommand, CommandCategory } from "./block-command";
import type { EditorT } from "./i18n";
import { AudioIcon, FileIcon, ImageIcon, VideoIcon } from "./icons";
import { MediaFileKind, resolveBinarySrc, resolveImageSrc, tryUploadFile } from "./media-upload";
import { $createAudioBlockNode } from "./nodes/audio-block-node";
import { $createFileBlockNode } from "./nodes/file-block-node";
import { $createImageBlockNode } from "./nodes/image-block-node";
import { $createVideoBlockNode } from "./nodes/video-block-node";

/** Slash-menu ids for the media commands, in display order — so a host
 *  that curates its slash palette can include them explicitly. */
export const MEDIA_COMMAND_IDS: readonly string[] = [
	"block.media.image",
	"block.media.video",
	"block.media.audio",
	"block.media.file",
];

export function createMediaBlockCommands(t: EditorT): readonly BlockCommand[] {
	return [
		{
			id: "block.media.image",
			category: CommandCategory.Media,
			label: t("editor.media.image"),
			description: t("editor.media.image.description"),
			icon: <ImageIcon />,
			keywords: ["image", "photo", "picture", "img", "media"],
			run: ({ editor }) => {
				insertImageViaPicker(editor);
			},
		},
		{
			id: "block.media.video",
			category: CommandCategory.Media,
			label: t("editor.media.video"),
			description: t("editor.media.video.description"),
			icon: <VideoIcon />,
			keywords: ["video", "movie", "clip", "media"],
			run: ({ editor }) => {
				insertVideoViaPicker(editor);
			},
		},
		{
			id: "block.media.audio",
			category: CommandCategory.Media,
			label: t("editor.media.audio"),
			description: t("editor.media.audio.description"),
			icon: <AudioIcon />,
			keywords: ["audio", "sound", "music", "voice", "recording", "media"],
			run: ({ editor }) => {
				pickFile(editor, "audio/*", (e, file) => insertBinaryBlock(e, file, MediaFileKind.Audio));
			},
		},
		{
			id: "block.media.file",
			category: CommandCategory.Media,
			label: t("editor.media.file"),
			description: t("editor.media.file.description"),
			icon: <FileIcon />,
			keywords: ["file", "attachment", "document", "download", "upload"],
			run: ({ editor }) => {
				pickFile(editor, "", (e, file) => insertBinaryBlock(e, file, MediaFileKind.File));
			},
		},
	];
}

function insertImageViaPicker(editor: LexicalEditor): void {
	const input = document.createElement("input");
	input.type = "file";
	input.accept = "image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml";
	input.addEventListener("change", () => {
		const file = input.files?.[0];
		if (!file) return;
		void insertImageFile(editor, file);
	});
	input.click();
}

async function insertImageFile(editor: LexicalEditor, file: File): Promise<void> {
	const src = await resolveImageSrc(file);
	if (!src) return;
	editor.update(
		() => {
			const sel = $getSelection();
			const block = $createImageBlockNode(src, file.name);
			if ($isRangeSelection(sel)) {
				const anchor = sel.anchor.getNode();
				try {
					anchor.getTopLevelElementOrThrow().replace(block);
					return;
				} catch {
					// fall through to root append
				}
			}
			$getRoot().append(block);
		},
		{ discrete: true },
	);
}

function insertVideoViaPicker(editor: LexicalEditor): void {
	const input = document.createElement("input");
	input.type = "file";
	input.accept = "video/mp4,video/webm,video/quicktime";
	input.addEventListener("change", () => {
		const file = input.files?.[0];
		if (!file) return;
		void insertVideoFile(editor, file);
	});
	input.click();
}

async function insertVideoFile(editor: LexicalEditor, file: File): Promise<void> {
	const url = await tryUploadFile(file);
	if (!url) {
		console.warn(
			"[editor/video] host uploadFile unavailable — videos are upload-only (no data-URL fallback because they're too large).",
		);
		return;
	}
	editor.update(
		() => {
			const sel = $getSelection();
			const block = $createVideoBlockNode(url, file.type);
			if ($isRangeSelection(sel)) {
				const anchor = sel.anchor.getNode();
				try {
					anchor.getTopLevelElementOrThrow().replace(block);
					return;
				} catch {
					// fall through
				}
			}
			$getRoot().append(block);
		},
		{ discrete: true },
	);
}

function pickFile(
	editor: LexicalEditor,
	accept: string,
	onFile: (editor: LexicalEditor, file: File) => void,
): void {
	const input = document.createElement("input");
	input.type = "file";
	if (accept) input.accept = accept;
	input.addEventListener("change", () => {
		const file = input.files?.[0];
		if (file) onFile(editor, file);
	});
	input.click();
}

async function insertBinaryBlock(
	editor: LexicalEditor,
	file: File,
	kind: MediaFileKind.Audio | MediaFileKind.File,
): Promise<void> {
	const src = await resolveBinarySrc(file);
	if (!src) return;
	editor.update(
		() => {
			const block =
				kind === MediaFileKind.Audio
					? $createAudioBlockNode(src, file.type, file.name)
					: $createFileBlockNode(src, file.name, file.size, file.type);
			const sel = $getSelection();
			if ($isRangeSelection(sel)) {
				const anchor = sel.anchor.getNode();
				try {
					anchor.getTopLevelElementOrThrow().replace(block);
					return;
				} catch {
					// fall through to root append
				}
			}
			$getRoot().append(block);
		},
		{ discrete: true },
	);
}
