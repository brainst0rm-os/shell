/**
 * Deterministic content hash over an installed app bundle (13.2).
 *
 * The hash is the integrity anchor recorded on the `apps` registry row at
 * install/update time (`bundle_sha256`) and surfaced on launch (the
 * `[shell] launch … build <sha>` line + the `?v=<sha>` cache-bust). It must be
 * a *stable* function of the bundle's content alone:
 *
 *   - file paths are walked recursively and **sorted** so two installs of the
 *     same files in a different on-disk/`readdir` order hash identically;
 *   - each file contributes a **length-prefixed** relative path followed by its
 *     **length-prefixed** raw bytes (8-byte big-endian byte counts). The length
 *     prefixes make the stream unambiguous: without them, file content
 *     containing the path/content separator could absorb the next file's
 *     boundary, letting two different bundles hash identically (a
 *     second-preimage collision — e.g. `{a:"Z", b:"Y"}` vs `{a:"Zb\0Y"}`).
 *   - directories themselves contribute nothing (an empty dir is invisible) —
 *     only file content + the path namespace matter.
 *
 * This lives in its own module (not inline in the installer) so the
 * determinism / reorder-stability contract is directly unit-testable and the
 * launcher's integrity-check seam (Stage 12) can recompute it the same way.
 *
 * SHA-256 via Node's `crypto` (OpenSSL-NAPI) per the NAPI considered-and-skipped
 * note in the implementation plan — file hashing is already native.
 */

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/** Per-entry copy predicate. Mirrors `fs.cp`'s filter-callback signature so the
 *  same `shouldCopyBundleEntry` rule the installer copies with can drive a
 *  pre-copy hash of the *source* tree — the source then hashes to the exact
 *  value the installer records on the registry row (13.10: the same-version
 *  content tiebreak compares the two, so dev-only files must not skew it). */
export type BundleEntryFilter = (absPath: string) => boolean;

/** Compute the deterministic SHA-256 (hex) over every file under `dir`. When a
 *  `filter` is supplied, only entries it admits are hashed — pass the installer's
 *  `shouldCopyBundleEntry` to hash a source tree as the installed copy would be. */
export async function hashBundleDirectory(
	dir: string,
	filter?: BundleEntryFilter,
): Promise<string> {
	const hash = createHash("sha256");
	const files = await collectBundleFiles(dir, "", filter);
	files.sort();
	for (const rel of files) {
		const path = Buffer.from(rel, "utf8");
		const content = await readFile(join(dir, rel));
		hash.update(u64be(path.byteLength));
		hash.update(path);
		hash.update(u64be(content.byteLength));
		hash.update(content);
	}
	return hash.digest("hex");
}

/** 8-byte big-endian length prefix — frames each field so attacker-controlled
 *  content can't absorb the next file's boundary (second-preimage hardening). */
function u64be(n: number): Buffer {
	const buf = Buffer.alloc(8);
	buf.writeBigUInt64BE(BigInt(n));
	return buf;
}

/** Relative file paths under `dir`, recursively. Order is not guaranteed —
 *  callers that need stability sort first (`hashBundleDirectory` does). A
 *  `filter` (matched on the absolute entry path) excludes both files and whole
 *  subtrees, mirroring the installer's copy filter. */
export async function collectBundleFiles(
	dir: string,
	base = "",
	filter?: BundleEntryFilter,
): Promise<string[]> {
	const out: string[] = [];
	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const rel = base ? `${base}/${entry.name}` : entry.name;
		const abs = join(dir, entry.name);
		if (filter && !filter(abs)) continue;
		if (entry.isDirectory()) {
			out.push(...(await collectBundleFiles(abs, rel, filter)));
		} else if (entry.isFile()) {
			out.push(rel);
		}
	}
	return out;
}
