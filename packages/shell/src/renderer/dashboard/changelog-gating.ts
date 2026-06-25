/**
 * Feedback-3 slice 2 — pure gating helpers for the auto-popup path.
 *
 * Mirrors the same comparison contract as `main/help/changelog.ts`'s
 * `compareVersions`/`unseenReleases` so the renderer can decide without
 * importing main-process code (preload re-exports types, not helpers).
 * `pickPopoverRelease` is the one decision the popover needs: given a
 * parsed changelog and the vault's `lastSeenChangelogVersion`, return
 * the newest release to surface, or `null` when nothing should be shown.
 *
 * Pure / side-effect-free — the popover wires the snapshot + IPC fetch;
 * this module is unit-tested in isolation so the gating math is pinned.
 */

import type { Changelog, ChangelogRelease } from "../../preload";

/** Compare two semver-ish version strings. Splits on `.`, compares
 *  numerically when both segments parse as integers, falls back to
 *  lexicographic. Negative when `a < b`, zero when equal, positive when
 *  `a > b`. Mirrors `main/help/changelog.ts`'s implementation byte-for-
 *  byte — a drift fence test pins them in `changelog-gating.test.ts`. */
export function compareVersions(a: string, b: string): number {
	const as = a.split(".");
	const bs = b.split(".");
	const len = Math.max(as.length, bs.length);
	for (let i = 0; i < len; i++) {
		const aPart = as[i] ?? "0";
		const bPart = bs[i] ?? "0";
		const aNum = Number.parseInt(aPart, 10);
		const bNum = Number.parseInt(bPart, 10);
		if (
			Number.isFinite(aNum) &&
			Number.isFinite(bNum) &&
			String(aNum) === aPart &&
			String(bNum) === bPart
		) {
			if (aNum !== bNum) return aNum - bNum;
			continue;
		}
		const lex = aPart.localeCompare(bPart);
		if (lex !== 0) return lex;
	}
	return 0;
}

/** Return the newest release to surface in the auto-popup, or `null`
 *  when the popup should stay hidden. The parsed changelog is newest-
 *  first (the parser sorts it), so the decision reduces to comparing
 *  `releases[0]` against `lastSeenVersion`. */
export function pickPopoverRelease(
	changelog: Changelog,
	lastSeenVersion: string | null | undefined,
): ChangelogRelease | null {
	const newest = changelog.releases[0];
	if (!newest) return null;
	if (lastSeenVersion === null || lastSeenVersion === undefined) return newest;
	return compareVersions(newest.version, lastSeenVersion) > 0 ? newest : null;
}

/** How many releases are unseen (strictly newer than `lastSeenVersion`).
 *  Drives the "and N more releases" footnote — pure, so the popover's
 *  display logic stays declarative. */
export function unseenReleaseCount(
	changelog: Changelog,
	lastSeenVersion: string | null | undefined,
): number {
	if (lastSeenVersion === null || lastSeenVersion === undefined) {
		return changelog.releases.length;
	}
	let count = 0;
	for (const release of changelog.releases) {
		if (compareVersions(release.version, lastSeenVersion) > 0) count += 1;
	}
	return count;
}
