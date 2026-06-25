/**
 * Minimal, dependency-free PKZIP reader for the IE-6 Notion export path.
 *
 * Notion's `Export → Markdown & CSV` ships a `.zip`; the rest of the import
 * stack works on already-extracted `{path, bytes}` entries (so the parser stays
 * pure + testable). Rather than add a zip dependency we hand-roll the reader the
 * same way the bundle codec hand-rolls tar — `node:zlib` does the deflate, this
 * module does the container. It is **hardened against hostile archives**, the
 * security floor doc 45 §IE-6 calls for: zip-slip paths (`..` / absolute /
 * drive-letter) are rejected, and per-entry / total / count limits defeat a zip
 * bomb. ZIP64 (entries ≥ 4 GiB) is out of scope for the beta path and reported
 * as a clear error rather than silently mis-read.
 */

import zlib from "node:zlib";

export type ZipEntry = {
	/** Forward-slash, archive-relative path (guaranteed traversal-safe). */
	readonly path: string;
	readonly bytes: Uint8Array;
};

export type ZipReadLimits = {
	readonly maxEntries: number;
	readonly maxEntryBytes: number;
	readonly maxTotalBytes: number;
};

const EOCD_SIG = 0x06054b50;
const CDIR_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const ZIP64_SENTINEL = 0xffffffff;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/** Reject zip-slip: any absolute path, drive letter, or `..` segment escapes the
 *  extraction root. Directory entries (trailing `/`) return null (skipped). */
function safeEntryPath(raw: string): string | null {
	const path = raw.replace(/\\/g, "/");
	if (path.length === 0 || path.endsWith("/")) return null;
	if (path.startsWith("/") || /^[a-z]:/i.test(path)) return null;
	if (path.split("/").some((segment) => segment === "..")) return null;
	return path;
}

function findEocd(buf: Buffer): number {
	// Scan backwards; the EOCD may be followed by a variable-length comment.
	const minStart = Math.max(0, buf.length - 0xffff - 22);
	for (let i = buf.length - 22; i >= minStart; i--) {
		if (buf.readUInt32LE(i) === EOCD_SIG) return i;
	}
	return -1;
}

/** Read every file entry from a PKZIP archive, inflating stored + deflate
 *  members. Throws on a malformed archive, a zip-slip path, ZIP64, an unknown
 *  compression method, or any breached limit. */
export function readZip(data: Uint8Array, limits: ZipReadLimits): ZipEntry[] {
	const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
	const eocd = findEocd(buf);
	if (eocd < 0) throw new Error("zip: no end-of-central-directory record (not a zip?)");

	const totalEntries = buf.readUInt16LE(eocd + 10);
	let cdOffset = buf.readUInt32LE(eocd + 16);
	if (cdOffset === ZIP64_SENTINEL || totalEntries === 0xffff) {
		throw new Error("zip: ZIP64 archives are not supported on this path");
	}
	if (totalEntries > limits.maxEntries) {
		throw new Error(`zip: archive exceeds ${limits.maxEntries} entries`);
	}

	const entries: ZipEntry[] = [];
	let totalBytes = 0;
	for (let n = 0; n < totalEntries; n++) {
		if (cdOffset + 46 > buf.length || buf.readUInt32LE(cdOffset) !== CDIR_SIG) {
			throw new Error("zip: corrupt central directory");
		}
		const method = buf.readUInt16LE(cdOffset + 10);
		const compressedSize = buf.readUInt32LE(cdOffset + 20);
		const uncompressedSize = buf.readUInt32LE(cdOffset + 24);
		const nameLen = buf.readUInt16LE(cdOffset + 28);
		const extraLen = buf.readUInt16LE(cdOffset + 30);
		const commentLen = buf.readUInt16LE(cdOffset + 32);
		const localOffset = buf.readUInt32LE(cdOffset + 42);
		const rawName = buf.toString("utf8", cdOffset + 46, cdOffset + 46 + nameLen);
		cdOffset += 46 + nameLen + extraLen + commentLen;

		if (compressedSize === ZIP64_SENTINEL || uncompressedSize === ZIP64_SENTINEL) {
			throw new Error("zip: ZIP64 archives are not supported on this path");
		}
		// Bound BOTH sizes: a stored member copies `compressedSize` bytes directly,
		// so checking only `uncompressedSize` (which a crafted record can set to 0)
		// would let the per-entry zip-bomb guard be bypassed for METHOD_STORED.
		if (uncompressedSize > limits.maxEntryBytes || compressedSize > limits.maxEntryBytes) {
			throw new Error(`zip: entry exceeds ${limits.maxEntryBytes} bytes`);
		}
		const path = safeEntryPath(rawName);
		if (path === null) continue; // directory or unsafe path — skip.

		// Re-read the data offset from the local header (its name/extra lengths
		// can differ from the central directory's). The local-header offset is
		// attacker-controlled, so bounds-check it before reading rather than
		// letting `readUInt32LE` throw an uncontrolled RangeError.
		if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL_SIG) {
			throw new Error("zip: corrupt local header");
		}
		const localNameLen = buf.readUInt16LE(localOffset + 26);
		const localExtraLen = buf.readUInt16LE(localOffset + 28);
		const dataStart = localOffset + 30 + localNameLen + localExtraLen;
		const compressed = buf.subarray(dataStart, dataStart + compressedSize);

		let bytes: Buffer;
		if (method === METHOD_STORED) {
			bytes = Buffer.from(compressed);
		} else if (method === METHOD_DEFLATE) {
			bytes = zlib.inflateRawSync(compressed, { maxOutputLength: limits.maxEntryBytes });
		} else {
			throw new Error(`zip: unsupported compression method ${method}`);
		}

		totalBytes += bytes.length;
		if (totalBytes > limits.maxTotalBytes) throw new Error("zip: archive too large to extract");
		entries.push({ path, bytes });
	}
	return entries;
}

const TEXT_DECODER = new TextDecoder("utf-8", { fatal: false });

/** Decode an entry's bytes as UTF-8 text (for `.md` / `.csv` / `.html`). */
export function zipEntryText(entry: ZipEntry): string {
	return TEXT_DECODER.decode(entry.bytes);
}
