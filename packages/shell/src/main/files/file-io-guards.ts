/**
 * 9.10 keystone — the pure, fail-safe guard the broker `files.write`
 * handler runs on untrusted app payload *before* it ever touches disk.
 *
 * `files.write(handle, data)` accepts the binary shapes that survive
 * the preload bridge: a `Uint8Array`/`Buffer`, an `ArrayBuffer`, or a
 * `{ base64 }` envelope (the only string form — a bare string is
 * ambiguous and rejected so an app can't accidentally write its own
 * source as UTF-8). A size ceiling bounds a single call (streaming
 * large writes is a deliberately-later concern, like covers'
 * downscale-on-disk ceiling). Rejections are returned as a discriminated
 * result, never thrown — the handler maps `ok:false` → `Invalid`,
 * mirroring `CoverUploadRejected`.
 *
 * Pure + dependency-light (only Node `Buffer` for base64, same as
 * covers); pairs with `file-handle-registry.ts` (write only proceeds
 * once the registry has fail-closed-resolved a `ReadWrite` handle) and
 * `dialog-options.ts`.
 */

/** Per-call write ceiling. Generous (these are real user files, not
 *  images we downscale) but bounded so one `files.write` can't be used
 *  to exhaust disk in a tight loop the audit layer would otherwise have
 *  to catch after the fact. */
export const MAX_WRITE_BYTES = 256 * 1024 * 1024;

export enum WriteRejectReason {
	/** Not one of the accepted binary shapes. */
	NotBinary = "not-binary",
	/** Exceeds the per-call byte ceiling. */
	TooLarge = "too-large",
}

export type WriteDecodeResult =
	| { ok: true; bytes: Uint8Array }
	| { ok: false; reason: WriteRejectReason; message: string };

function reject(reason: WriteRejectReason, message: string): WriteDecodeResult {
	return { ok: false, reason, message };
}

function isPlainBase64Envelope(v: unknown): v is { base64: string } {
	return (
		!!v &&
		typeof v === "object" &&
		!Array.isArray(v) &&
		typeof (v as Record<string, unknown>).base64 === "string"
	);
}

/**
 * Normalize app `files.write` data to a byte array, or a typed
 * rejection. Empty content is **valid** (truncate-to-zero). An
 * over-ceiling payload is rejected pre-decode where the size is already
 * known (ArrayBuffer / typed array), and post-decode for base64.
 */
export function decodeWriteData(
	data: unknown,
	maxBytes: number = MAX_WRITE_BYTES,
): WriteDecodeResult {
	const ceiling = Number.isFinite(maxBytes) && maxBytes >= 0 ? maxBytes : MAX_WRITE_BYTES;

	// Uint8Array (incl. Node Buffer, a subclass).
	if (data instanceof Uint8Array) {
		if (data.byteLength > ceiling) {
			return reject(WriteRejectReason.TooLarge, `write exceeds ${ceiling} bytes`);
		}
		return { ok: true, bytes: data };
	}

	if (data instanceof ArrayBuffer) {
		if (data.byteLength > ceiling) {
			return reject(WriteRejectReason.TooLarge, `write exceeds ${ceiling} bytes`);
		}
		return { ok: true, bytes: new Uint8Array(data) };
	}

	if (isPlainBase64Envelope(data)) {
		const bytes = new Uint8Array(Buffer.from(data.base64, "base64"));
		if (bytes.byteLength > ceiling) {
			return reject(WriteRejectReason.TooLarge, `write exceeds ${ceiling} bytes`);
		}
		return { ok: true, bytes };
	}

	return reject(
		WriteRejectReason.NotBinary,
		"files.write data must be a Uint8Array, ArrayBuffer, or { base64 }",
	);
}
