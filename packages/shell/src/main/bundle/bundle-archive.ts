/**
 * `.bsbundle` outer container (IE-1).
 *
 * Frames the deterministic tar (`bundle-tar.ts`) in a tiny self-describing
 * header so a reader knows how to decompress *before* it can read the inner
 * `manifest.json`:
 *
 *   ┌────────┬──────────┬────────────┬───────────────────────────┐
 *   │ "BSB1" │ ver (1B) │ algo (1B)  │ compressed tar (rest)     │
 *   └────────┴──────────┴────────────┴───────────────────────────┘
 *
 * Compression is a seam: doc 45 names zstd, but `node:zlib` only exposes it
 * on newer runtimes (and not under every test runtime). We use zstd when the
 * runtime offers it and fall back to gzip — recording the actual algorithm in
 * the header — rather than putting a native dependency on the beta critical
 * path. Both are deterministic at a fixed level within one runtime, which is
 * all the byte-level round-trip guarantee requires.
 */

import { Buffer } from "node:buffer";
import * as zlib from "node:zlib";
import { BUNDLE_CONTAINER_VERSION, BUNDLE_MAGIC, BundleCompression } from "./bundle-format";
import { type TarEntry, packTar, unpackTar } from "./bundle-tar";

const MAGIC_BYTES = Buffer.from(BUNDLE_MAGIC, "ascii");
const GZIP_LEVEL = 9;

const COMPRESSION_CODE: Record<BundleCompression, number> = {
	[BundleCompression.None]: 0,
	[BundleCompression.Gzip]: 1,
	[BundleCompression.Zstd]: 2,
};
const CODE_COMPRESSION: Record<number, BundleCompression> = {
	0: BundleCompression.None,
	1: BundleCompression.Gzip,
	2: BundleCompression.Zstd,
};

type ZstdCapableZlib = typeof zlib & {
	zstdCompressSync: (buf: Buffer) => Buffer;
	zstdDecompressSync: (buf: Buffer) => Buffer;
};

function zstdCapable(): ZstdCapableZlib | null {
	const candidate = zlib as Partial<ZstdCapableZlib>;
	return typeof candidate.zstdCompressSync === "function" &&
		typeof candidate.zstdDecompressSync === "function"
		? (zlib as ZstdCapableZlib)
		: null;
}

/** The algorithm the running runtime will actually use for a new export
 *  (zstd when available, else gzip). */
export function preferredCompression(): BundleCompression {
	return zstdCapable() ? BundleCompression.Zstd : BundleCompression.Gzip;
}

function compress(algo: BundleCompression, bytes: Buffer): Buffer {
	switch (algo) {
		case BundleCompression.None:
			return bytes;
		case BundleCompression.Gzip:
			return zlib.gzipSync(bytes, { level: GZIP_LEVEL });
		case BundleCompression.Zstd: {
			const z = zstdCapable();
			if (!z) throw new Error("bundle: zstd requested but unavailable in this runtime");
			return z.zstdCompressSync(bytes);
		}
	}
}

function decompress(algo: BundleCompression, bytes: Buffer): Buffer {
	switch (algo) {
		case BundleCompression.None:
			return bytes;
		case BundleCompression.Gzip:
			return zlib.gunzipSync(bytes);
		case BundleCompression.Zstd: {
			const z = zstdCapable();
			if (!z) throw new Error("bundle: zstd bundle cannot be read in this runtime");
			return z.zstdDecompressSync(bytes);
		}
	}
}

/** Pack a path→bytes map into a finished `.bsbundle` byte buffer. Entries are
 *  sorted by path so the same content always produces the same archive. */
export function packBundle(
	files: ReadonlyMap<string, Uint8Array>,
	algo: BundleCompression = preferredCompression(),
): Uint8Array {
	const entries: TarEntry[] = [...files.entries()]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([path, data]) => ({ path, data }));
	const tar = Buffer.from(packTar(entries));
	const payload = compress(algo, tar);
	const head = Buffer.alloc(MAGIC_BYTES.length + 2);
	MAGIC_BYTES.copy(head, 0);
	head[MAGIC_BYTES.length] = BUNDLE_CONTAINER_VERSION;
	head[MAGIC_BYTES.length + 1] = COMPRESSION_CODE[algo];
	return Buffer.concat([head, payload]);
}

/** Unpack a `.bsbundle` byte buffer into a path→bytes map. Throws on a bad
 *  magic / unknown container version / unknown compression code. */
export function unpackBundle(bundle: Uint8Array): Map<string, Uint8Array> {
	const buf = Buffer.from(bundle);
	if (
		buf.length < MAGIC_BYTES.length + 2 ||
		!buf.subarray(0, MAGIC_BYTES.length).equals(MAGIC_BYTES)
	) {
		throw new Error("bundle: not a .bsbundle (bad magic)");
	}
	const version = buf[MAGIC_BYTES.length] ?? 0;
	if (version !== BUNDLE_CONTAINER_VERSION) {
		throw new Error(`bundle: unsupported container version ${version}`);
	}
	const code = buf[MAGIC_BYTES.length + 1] ?? -1;
	const algo = CODE_COMPRESSION[code];
	if (algo === undefined) {
		throw new Error(`bundle: unknown compression code ${code}`);
	}
	const tar = decompress(algo, buf.subarray(MAGIC_BYTES.length + 2));
	const out = new Map<string, Uint8Array>();
	for (const entry of unpackTar(tar)) out.set(entry.path, entry.data);
	return out;
}
