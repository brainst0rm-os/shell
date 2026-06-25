/**
 * Minimal deterministic USTAR pack / unpack — test-only.
 *
 * The vault-portability suite (13.5) proves a raw on-disk vault directory
 * survives a tar → move → untar round-trip. A real `tar` dependency isn't in
 * the workspace (and the project rule is not to add a heavy dep just for a
 * test), so this is a self-contained POSIX-`ustar`-format packer covering
 * exactly what a vault dir holds: regular files + directories. No symlinks,
 * no hardlinks, no long-name (>100 byte) GNU extensions — vault paths are
 * short, sharded ids.
 *
 * Determinism: entries are emitted in sorted path order with fixed mode /
 * mtime / uid / gid, so packing the same tree twice yields byte-identical
 * archives. That lets a test assert a re-pack after the round-trip matches.
 *
 * Portability of the format itself is the point: tar stores forward-slash
 * paths and the unpacker rewrites them through `node:path`, so an archive
 * written on a `\`-separator host untars correctly on a `/`-separator host
 * (and vice-versa). The suite exercises that path-separator normalisation.
 */

import { Buffer } from "node:buffer";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, posix, sep } from "node:path";

const BLOCK = 512;
const FIXED_MODE = "0000644";
const DIR_MODE = "0000755";
const FIXED_MTIME = 0;

enum TypeFlag {
	File = "0",
	Dir = "5",
}

type PackEntry = {
	/** Archive path, always `/`-separated (POSIX tar convention). */
	name: string;
	type: TypeFlag;
	data: Buffer;
};

/**
 * Recursively collect every file + directory under `root`, with archive
 * names relative to `root` and forced to forward slashes regardless of the
 * host separator. Sorted for determinism.
 */
async function collect(root: string): Promise<PackEntry[]> {
	const entries: PackEntry[] = [];
	async function walk(absDir: string, relDir: string): Promise<void> {
		const names = (await readdir(absDir)).sort();
		for (const name of names) {
			const abs = join(absDir, name);
			const rel = relDir ? `${relDir}/${name}` : name;
			const info = await stat(abs);
			if (info.isDirectory()) {
				entries.push({ name: `${rel}/`, type: TypeFlag.Dir, data: Buffer.alloc(0) });
				await walk(abs, rel);
			} else if (info.isFile()) {
				entries.push({ name: rel, type: TypeFlag.File, data: await readFile(abs) });
			}
		}
	}
	await walk(root, "");
	return entries;
}

function octal(value: number, width: number): string {
	return value.toString(8).padStart(width - 1, "0");
}

function header(entry: PackEntry): Buffer {
	const block = Buffer.alloc(BLOCK);
	if (Buffer.byteLength(entry.name, "utf8") > 100) {
		throw new Error(`tar: path too long for ustar (>100 bytes): ${entry.name}`);
	}
	block.write(entry.name, 0, 100, "utf8");
	block.write(`${entry.type === TypeFlag.Dir ? DIR_MODE : FIXED_MODE}\0`, 100, 8, "ascii");
	block.write("0000000\0", 108, 8, "ascii"); // uid
	block.write("0000000\0", 116, 8, "ascii"); // gid
	block.write(`${octal(entry.data.length, 12)}\0`, 124, 12, "ascii");
	block.write(`${octal(FIXED_MTIME, 12)}\0`, 136, 12, "ascii");
	block.write(entry.type, 156, 1, "ascii");
	block.write("ustar\0", 257, 6, "ascii");
	block.write("00", 263, 2, "ascii");
	// Checksum: sum of all header bytes with the checksum field taken as spaces.
	block.write("        ", 148, 8, "ascii");
	let sum = 0;
	for (let i = 0; i < BLOCK; i++) sum += block[i] ?? 0;
	block.write(`${octal(sum, 7)}\0 `, 148, 8, "ascii");
	return block;
}

/** Pack a directory tree into a single USTAR buffer (deterministic). */
export async function packDirToTar(root: string): Promise<Buffer> {
	const entries = await collect(root);
	const chunks: Buffer[] = [];
	for (const entry of entries) {
		chunks.push(header(entry));
		if (entry.data.length > 0) {
			chunks.push(entry.data);
			const pad = (BLOCK - (entry.data.length % BLOCK)) % BLOCK;
			if (pad > 0) chunks.push(Buffer.alloc(pad));
		}
	}
	// Two zero blocks terminate the archive.
	chunks.push(Buffer.alloc(BLOCK * 2));
	return Buffer.concat(chunks);
}

function parseOctal(field: Buffer): number {
	const text = field.toString("ascii").replace(/\0.*$/, "").trim();
	return text.length === 0 ? 0 : Number.parseInt(text, 8);
}

/**
 * Unpack a USTAR buffer into `dest`. Archive names are `/`-separated; we
 * rewrite each through `node:path` so the extracted layout uses the host
 * separator (the portability assertion: a `/`-named archive lands correctly
 * on a `\` host). A `..` segment in any name is rejected — path-traversal
 * defence, even in a test helper.
 */
export async function unpackTarToDir(archive: Buffer, dest: string): Promise<void> {
	await mkdir(dest, { recursive: true });
	let offset = 0;
	while (offset + BLOCK <= archive.length) {
		const head = archive.subarray(offset, offset + BLOCK);
		offset += BLOCK;
		// A full zero block marks end-of-archive.
		if (head.every((b) => b === 0)) break;
		const rawName = head.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
		const type = String.fromCharCode(head[156] ?? 0);
		const size = parseOctal(head.subarray(124, 136));

		const segments = rawName.split(posix.sep).filter((s) => s.length > 0);
		if (segments.includes("..")) {
			throw new Error(`tar: refusing path-traversal entry: ${rawName}`);
		}
		const target = segments.length > 0 ? join(dest, segments.join(sep)) : dest;

		if (type === TypeFlag.Dir) {
			await mkdir(target, { recursive: true });
		} else {
			const data = archive.subarray(offset, offset + size);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, data);
		}
		offset += Math.ceil(size / BLOCK) * BLOCK;
	}
}
