/**
 * File-upload helpers used by the shared media surfaces:
 *   - `/image` `/video` `/audio` `/file` slash commands (`media-commands.tsx`)
 *   - drag-drop + paste of media files (`plugins/media-drop-plugin.tsx`)
 *
 * `tryUploadFile` calls the host-supplied uploader (`getEditorHost().uploadFile`,
 * wired by each app at boot from `services.storage.uploadFile`) and returns a
 * `brainstorm://app-file/...` URL on success, `null` if no host uploader is
 * wired (preview / older shell) or the upload itself fails.
 *
 * `resolveImageSrc` adds the inline-data-URL fallback that's safe for
 * images (cap'd at 2 MiB so the doc's autosave doesn't crush itself).
 * Videos use `tryUploadFile` directly — they're too large to inline.
 */

import { getEditorHost } from "./plugins/editor-host";

const MAX_IMAGE_DATA_URL_BYTES = 1024 * 1024 * 2;
const MAX_INLINE_DATA_URL_BYTES = 1024 * 1024 * 2;

/** Which embed block a dropped/pasted file becomes. */
export enum MediaFileKind {
	Image = "image",
	Video = "video",
	Audio = "audio",
	File = "file",
}

export function classifyMediaFile(file: File): MediaFileKind {
	if (file.type.startsWith("image/")) return MediaFileKind.Image;
	if (file.type.startsWith("video/")) return MediaFileKind.Video;
	if (file.type.startsWith("audio/")) return MediaFileKind.Audio;
	return MediaFileKind.File;
}

/** Upload-first source resolution for audio / generic files. Falls back
 *  to an inline data URL only under the cap (parity with images); large
 *  files require a host uploader and bail with a warning otherwise. */
export async function resolveBinarySrc(file: File): Promise<string | null> {
	const uploaded = await tryUploadFile(file);
	if (uploaded) return uploaded;
	if (file.size > MAX_INLINE_DATA_URL_BYTES) {
		console.warn(
			`[editor/upload] "${file.name}" too large (${(file.size / 1024).toFixed(0)} KB) for inline data URL and no host uploader is wired.`,
		);
		return null;
	}
	return readAsDataUrl(file);
}

export async function resolveImageSrc(file: File): Promise<string | null> {
	const uploaded = await tryUploadFile(file);
	if (uploaded) return uploaded;
	if (file.size > MAX_IMAGE_DATA_URL_BYTES) {
		console.warn(
			`[editor/image] file too large (${(file.size / 1024).toFixed(0)} KB) for inline data URL and no host uploader is wired.`,
		);
		return null;
	}
	return readAsDataUrl(file);
}

export async function tryUploadFile(file: File): Promise<string | null> {
	const uploadFile = getEditorHost().uploadFile;
	if (typeof uploadFile !== "function") return null;
	try {
		const bytes = new Uint8Array(await file.arrayBuffer());
		const result = await uploadFile(file.name, bytes, file.type);
		return result.url;
	} catch (error) {
		console.warn("[editor/upload] host uploadFile failed:", error);
		return null;
	}
}

export function readAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			if (typeof reader.result === "string") resolve(reader.result);
			else reject(new Error("FileReader produced non-string result"));
		};
		reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
		reader.readAsDataURL(file);
	});
}

/** Files an editor can embed. Every file qualifies: image/video/audio
 *  get their rich block, anything else becomes a generic file chip. */
export function collectMediaFiles(files: FileList | null | undefined): File[] {
	return files ? Array.from(files) : [];
}

/** `true` when the dataTransfer object carries any file-kind entry —
 *  used to gate `dragover.preventDefault` so the browser shows the drop
 *  affordance only when we'd actually accept the drop. */
export function dataTransferHasFiles(dt: DataTransfer | null | undefined): boolean {
	if (!dt) return false;
	for (const type of dt.types) {
		if (type === "Files") return true;
	}
	return false;
}
