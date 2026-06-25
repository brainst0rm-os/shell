/**
 * Image insertion (9.17.11) — pure Files-host pick → read → data-URL pipeline.
 *
 * The app's CSP is `img-src 'self' data: brainstorm:`, so a remote `https:`
 * image would never paint — image nodes must inline their bytes as a `data:`
 * URL read from the local filesystem through the Files host (Stage 9.10). This
 * module owns the pick/read/encode below a tagged `PickImageResult`; the app
 * half just turns a `Picked` into an `ImageNode`. Mirrors the database
 * `import-orchestrator` (read side) + `requestSaveBytes` (save side) disposition
 * pattern — never throws, every error path collapses to `Failed`.
 */

/** Minimal slice of the Files service this flow needs (open + read). */
export type PickImageService = {
	requestOpen(opts?: {
		readonly title?: string;
		readonly filters?: readonly { readonly name: string; readonly extensions: readonly string[] }[];
		readonly multi?: boolean;
	}): Promise<readonly { readonly handleId: string; readonly displayName: string }[]>;
	read(handle: { readonly handleId: string; readonly displayName: string }): Promise<Uint8Array>;
};

/** Raster formats the inline-image flow accepts — matches the wallpaper
 *  upload set (CSP-safe `data:` URLs, no SVG to avoid embedding markup). */
export const IMAGE_EXTENSIONS: readonly string[] = Object.freeze([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"avif",
]);

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	avif: "image/avif",
});

export enum PickImageKind {
	/** User dismissed the OS picker — not an error (the `requestOpen → []`
	 *  cancellation contract). */
	Cancelled = "cancelled",
	/** Picked file's extension isn't a supported raster format. */
	Unsupported = "unsupported",
	/** `read` rejected, or encoding failed. */
	Failed = "failed",
	/** Picked file exceeds the inline-image ceiling. */
	TooLarge = "too-large",
	/** A ready-to-mount `data:` URL. */
	Picked = "picked",
}

/** Hard ceiling on an inlined board image. The whole board (every node's
 *  `data:` URL) is re-serialised into entity properties on EVERY mutation
 *  and `structuredClone`d into the undo history, so a large inline image
 *  multiplies into IPC + memory cost — cap well below the Files host's
 *  256 MiB write limit. Larger images want the asset store (a follow-on). */
export const MAX_INLINE_IMAGE_BYTES = 4 * 1024 * 1024;

export type PickImageResult =
	| { readonly kind: PickImageKind.Cancelled }
	| {
			readonly kind: PickImageKind.Unsupported;
			readonly filename: string;
			readonly extension: string;
	  }
	| { readonly kind: PickImageKind.Failed; readonly filename: string; readonly error: unknown }
	| {
			readonly kind: PickImageKind.TooLarge;
			readonly filename: string;
			readonly bytes: number;
			readonly limit: number;
	  }
	| { readonly kind: PickImageKind.Picked; readonly filename: string; readonly dataUrl: string };

/** The image MIME for a lowercased extension, or `null` if unsupported. */
export function mimeForExtension(ext: string): string | null {
	return MIME_BY_EXTENSION[ext] ?? null;
}

/** Lowercased tail after the last `.`, or `""` (no extension / dotfile). */
export function extensionOf(filename: string): string {
	const dot = filename.lastIndexOf(".");
	if (dot <= 0 || dot === filename.length - 1) return "";
	return filename.slice(dot + 1).toLowerCase();
}

/** Encode raw bytes as a `data:<mime>;base64,…` URL. Chunked base64 so a
 *  multi-MB image doesn't blow the argument limit of `String.fromCharCode`
 *  via a spread. */
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
	let binary = "";
	const CHUNK = 0x8000;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		const slice = bytes.subarray(i, i + CHUNK);
		binary += String.fromCharCode(...slice);
	}
	return `data:${mime};base64,${btoa(binary)}`;
}

/** Pick one image file, read it, and return a `data:` URL ready to mount.
 *  Pure relative to its injected `files` service (no runtime singleton). */
export async function pickImage(
	files: PickImageService,
	opts?: { readonly title?: string; readonly filterName?: string },
): Promise<PickImageResult> {
	const handles = await files.requestOpen({
		filters: [{ name: opts?.filterName ?? "Images", extensions: IMAGE_EXTENSIONS }],
		multi: false,
		...(opts?.title !== undefined ? { title: opts.title } : {}),
	});
	const handle = handles[0];
	if (!handle) return { kind: PickImageKind.Cancelled };

	const filename = handle.displayName;
	const extension = extensionOf(filename);
	const mime = mimeForExtension(extension);
	if (!mime) return { kind: PickImageKind.Unsupported, filename, extension };

	let bytes: Uint8Array;
	try {
		bytes = await files.read(handle);
	} catch (error) {
		return { kind: PickImageKind.Failed, filename, error };
	}

	if (bytes.byteLength > MAX_INLINE_IMAGE_BYTES) {
		return {
			kind: PickImageKind.TooLarge,
			filename,
			bytes: bytes.byteLength,
			limit: MAX_INLINE_IMAGE_BYTES,
		};
	}

	try {
		return { kind: PickImageKind.Picked, filename, dataUrl: bytesToDataUrl(bytes, mime) };
	} catch (error) {
		return { kind: PickImageKind.Failed, filename, error };
	}
}
