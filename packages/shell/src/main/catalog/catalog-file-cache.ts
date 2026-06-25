/**
 * 14.32 — file-backed catalog cache. Persists the last good verified index at
 * `<userData>/catalog-index.json` so the Marketplace renders + the update engine
 * no-op offline, surviving a restart. App-global (the catalog is about the
 * install surface, not the open vault), mirroring `UpdatePrefsStore`.
 *
 * Defensive default-on-corrupt: an unreadable / malformed / schema-invalid file
 * reads as "no cache" (null) rather than throwing — the next successful refresh
 * overwrites it. Writes are synchronous (the cache is tiny and the
 * `CatalogCacheStore` interface is sync, matching the in-memory impl).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CatalogCacheStore } from "./catalog-client";
import { validateCatalogIndex } from "./catalog-core";
import type { CatalogIndex } from "./catalog-wire-types";

const CACHE_FILE_NAME = "catalog-index.json";

export function catalogCachePath(userDataDir: string): string {
	return join(userDataDir, CACHE_FILE_NAME);
}

export class CatalogFileCache implements CatalogCacheStore {
	private readonly path: string;
	/** In-memory mirror so repeated `load()`s don't re-read + re-parse the file. */
	private cache: CatalogIndex | null = null;
	private loaded = false;

	constructor(options: { readonly path: string }) {
		this.path = options.path;
	}

	load(): CatalogIndex | null {
		if (this.loaded) return this.cache;
		this.cache = this.readFromDisk();
		this.loaded = true;
		return this.cache;
	}

	save(index: CatalogIndex): void {
		this.cache = index;
		this.loaded = true;
		try {
			mkdirSync(dirname(this.path), { recursive: true });
			writeFileSync(this.path, `${JSON.stringify(index)}\n`, "utf8");
		} catch {
			// A failed write leaves the in-memory copy authoritative for this run;
			// the cache is best-effort, never load-bearing for correctness.
		}
	}

	private readFromDisk(): CatalogIndex | null {
		let raw: string;
		try {
			raw = readFileSync(this.path, "utf8");
		} catch {
			return null;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			return null;
		}
		return validateCatalogIndex(parsed);
	}
}
