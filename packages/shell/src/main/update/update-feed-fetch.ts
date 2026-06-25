/**
 * 13.6 — release-feed fetch binding.
 *
 * The shell's OWN egress to a build-time-constant release feed URL — not
 * an app-brokered fetch, so it doesn't ride the per-app capability /
 * SSRF machinery (the destination is a fixed first-party URL, not
 * attacker-influenced). Electron-bound (`net.fetch`); the pure decode +
 * evaluation is `update-core.ts`, which is where the tests live. A failed
 * fetch resolves to `null` so `UpdateService.check()` degrades to
 * `Unknown` rather than throwing.
 */

import { net } from "electron";

/** Default feed URL. Override with `BRAINSTORM_UPDATE_FEED_URL` (dev /
 *  staging). The real host is wired alongside cert procurement + the
 *  release pipeline (13.1c `release.yml` already publishes the artefacts;
 *  the feed JSON is generated next to the GitHub release). */
export const DEFAULT_UPDATE_FEED_URL = "https://brainstorm.app/releases/feed.json";

const FETCH_TIMEOUT_MS = 5_000;

export async function fetchUpdateFeedJson(url: string): Promise<unknown> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const response = await net.fetch(url, { signal: controller.signal });
		if (!response.ok) return null;
		return await response.json();
	} catch (_error) {
		return null;
	} finally {
		clearTimeout(timer);
	}
}
