/**
 * Deterministic USTAR codec for `.bsbundle` (IE-1).
 *
 * The vault-portability suite (13.5) shipped a *test-only* tar packer capped
 * at 100-byte paths. The bundle format needs a production codec: entity paths
 * (`entities/<reverse-dns-type>/<uuid>.json`) can exceed 100 bytes for a long
 * custom type, so this supports the GNU long-name extension (`L` typeflag).
 *
 * Determinism is a hard requirement — the round-trip guarantee compares two
 * bundles byte-for-byte. Callers pass entries in their desired order (the
 * export engine sorts by path); headers carry fixed mode / mtime / uid / gid,
 * so the same entry set always yields the same bytes.
 *
 * Reading is path-traversal-safe: any `..` segment or absolute path is
 * rejected (a bundle is untrusted input — doc 45 §Security for the migration
 * importers; the same defence applies to restore).
 */

import { Buffer } from "node:buffer";

const BLOCK = 512;
const FIXED_MODE = "0000644";
const FIXED_META = "0000000\0";
const FIXED_MTIME = 0;
const GNU_LONGNAME = "././@LongLink";

enum TypeFlag {
	File = "0",
	GnuLongName = "L",
}

export type TarEntry = {
	/** Archive path, always `/`-separated. */
	readonly path: string;
	readonly data: Uint8Array;
};

function octal(value: number, width: number): string {
	return value.toString(8).padStart(width - 1, "0");
}

function checksum(block: Buffer): number {
	let sum = 0;
	for (let i = 0; i < BLOCK; i++) sum += block[i] ?? 0;
	return sum;
}

function header(name: string, type: TypeFlag, size: number): Buffer {
	const block = Buffer.alloc(BLOCK);
	// A long name is carried in a preceding GNU entry; the truncation here is
	// cosmetic (readers take the name from the long-name entry).
	block.write(name.slice(0, 100), 0, 100, "utf8");
	block.write(`${FIXED_MODE}\0`, 100, 8, "ascii");
	block.write(FIXED_META, 108, 8, "ascii"); // uid
	block.write(FIXED_META, 116, 8, "ascii"); // gid
	block.write(`${octal(size, 12)}\0`, 124, 12, "ascii");
	block.write(`${octal(FIXED_MTIME, 12)}\0`, 136, 12, "ascii");
	block.write(type, 156, 1, "ascii");
	block.write("ustar\0", 257, 6, "ascii");
	block.write("00", 263, 2, "ascii");
	block.write("        ", 148, 8, "ascii"); // checksum field spaces during compute
	block.write(`${octal(checksum(block), 7)}\0 `, 148, 8, "ascii");
	return block;
}

function padTo512(len: number): number {
	return (BLOCK - (len % BLOCK)) % BLOCK;
}

function emit(chunks: Buffer[], name: string, type: TypeFlag, data: Buffer): void {
	chunks.push(header(name, type, data.length));
	if (data.length > 0) {
		chunks.push(data);
		const pad = padTo512(data.length);
		if (pad > 0) chunks.push(Buffer.alloc(pad));
	}
}

/** Pack entries into a single USTAR buffer. Entries are emitted in the given
 *  order (the caller owns sorting for determinism). */
export function packTar(entries: readonly TarEntry[]): Uint8Array {
	const chunks: Buffer[] = [];
	for (const entry of entries) {
		const data = Buffer.from(entry.data);
		if (Buffer.byteLength(entry.path, "utf8") > 100) {
			const nameBytes = Buffer.from(`${entry.path}\0`, "utf8");
			emit(chunks, GNU_LONGNAME, TypeFlag.GnuLongName, nameBytes);
		}
		emit(chunks, entry.path, TypeFlag.File, data);
	}
	chunks.push(Buffer.alloc(BLOCK * 2)); // two zero blocks terminate the archive
	return Buffer.concat(chunks);
}

function parseOctal(field: Buffer): number {
	const text = field.toString("ascii").replace(/\0.*$/, "").trim();
	return text.length === 0 ? 0 : Number.parseInt(text, 8);
}

function assertSafePath(path: string): void {
	const normalized = path.replace(/\\/g, "/");
	if (normalized.startsWith("/")) {
		throw new Error(`tar: refusing absolute path: ${path}`);
	}
	const segments = normalized.split("/");
	if (segments.includes("..")) {
		throw new Error(`tar: refusing path-traversal entry: ${path}`);
	}
}

/** Unpack a USTAR buffer into an ordered list of entries. Rejects unsafe
 *  paths; resolves GNU long names. Trailing zero blocks end the scan. */
export function unpackTar(archive: Uint8Array): TarEntry[] {
	const buf = Buffer.from(archive);
	const out: TarEntry[] = [];
	let offset = 0;
	let pendingLongName: string | null = null;
	while (offset + BLOCK <= buf.length) {
		const head = buf.subarray(offset, offset + BLOCK);
		offset += BLOCK;
		if (head.every((b) => b === 0)) break; // end-of-archive
		const rawName = head.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
		const type = String.fromCharCode(head[156] ?? 0);
		const size = parseOctal(head.subarray(124, 136));
		const data = buf.subarray(offset, offset + size);
		offset += Math.ceil(size / BLOCK) * BLOCK;

		if (type === TypeFlag.GnuLongName) {
			pendingLongName = data.toString("utf8").replace(/\0.*$/, "");
			continue;
		}
		const name = pendingLongName ?? rawName;
		pendingLongName = null;
		assertSafePath(name);
		out.push({ path: name, data: new Uint8Array(data) });
	}
	return out;
}
