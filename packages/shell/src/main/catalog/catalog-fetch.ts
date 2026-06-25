/**
 * 14.32 — catalog-index fetch binding. The shell's OWN egress to a build-time-
 * constant catalog URL (not an app-brokered fetch — the destination is a fixed
 * first-party origin, not attacker-influenced), mirroring `update-feed-fetch`.
 * Electron-bound (`net.fetch`); the pure verify + decode lives in
 * `catalog-core.ts` (where the tests are). The `CatalogClient` treats a thrown
 * error / non-200 as `Unavailable` and keeps the last good cached index.
 */

import { net } from "electron";

/** Default official-catalog index URL. Override with `BRAINSTORM_CATALOG_URL`
 *  (dev points this at a local `catalog-edge`, e.g. `http://127.0.0.1:8788`).
 *  The real host is wired alongside the publish pipeline (14.34). */
export const DEFAULT_CATALOG_BASE_URL = "https://brainstorm.app/catalog";

const FETCH_TIMEOUT_MS = 5_000;

export function catalogBaseUrl(): string {
	const override = process.env.BRAINSTORM_CATALOG_URL;
	return override && override.length > 0 ? override.replace(/\/$/, "") : DEFAULT_CATALOG_BASE_URL;
}

export function catalogIndexUrl(baseUrl: string = catalogBaseUrl()): string {
	return `${baseUrl}/v1/catalog/index`;
}

/** Fetch + JSON-parse the signed catalog index. Throws on any failure so the
 *  `CatalogClient` resolves `Unavailable` (keeping the last good cache). */
export async function fetchCatalogIndexJson(url: string = catalogIndexUrl()): Promise<unknown> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const response = await net.fetch(url, { signal: controller.signal });
		if (!response.ok) throw new Error(`catalog index fetch: HTTP ${response.status}`);
		return await response.json();
	} finally {
		clearTimeout(timer);
	}
}
