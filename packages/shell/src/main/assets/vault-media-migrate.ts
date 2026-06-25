/**
 * One-time, idempotent re-seal of legacy plaintext media files (OQ-240). On
 * vault open the session walks each media domain dir and encrypts any file that
 * isn't already sealed, so existing vaults reach at-rest parity without the user
 * re-uploading anything. Best-effort: a single file failure is logged and
 * skipped, never aborting the walk or blocking vault open. Atomic per file
 * (write temp → rename) so a crash mid-migration can't truncate an image.
 */

import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type VaultMediaDomain, isSealedMedia, sealMedia } from "./vault-media-crypto";

const RESEAL_TMP_SUFFIX = ".reseal-tmp";

/** Re-seal every plaintext file in one media domain dir. Returns the count
 *  newly sealed (0 when the dir doesn't exist yet). */
export async function migrateMediaDir(
	vaultPath: string,
	domain: VaultMediaDomain,
	key: Uint8Array,
): Promise<number> {
	const dir = join(vaultPath, domain);
	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		return 0;
	}
	let sealed = 0;
	for (const name of names) {
		if (name.endsWith(RESEAL_TMP_SUFFIX)) continue;
		const path = join(dir, name);
		try {
			const bytes = await readFile(path);
			if (isSealedMedia(bytes)) continue;
			const tmp = `${path}${RESEAL_TMP_SUFFIX}`;
			await writeFile(tmp, sealMedia(key, domain, name, bytes));
			await rename(tmp, path);
			sealed += 1;
		} catch (error) {
			console.warn(`[brainstorm] media re-seal skipped ${domain}/${name}:`, error);
		}
	}
	return sealed;
}
