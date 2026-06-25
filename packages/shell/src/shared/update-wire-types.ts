/**
 * 13.6 — beta-channel manual-download update mechanism (wire types).
 *
 * Renderer-safe: zero imports, no electron, no node — so the renderer
 * bundle can `switch` on these enums without pulling a main-process
 * module in (the [[feedback_renderer_value_imports_from_preload]]
 * convention the vault-recovery + app-lock wire types follow).
 *
 * v1 is *manual-download*: a check resolves to "you're up to date" /
 * "version X is available, here's the download page" / "couldn't
 * check". No download, no install, no auto-update — that's v2. The
 * `downloadUrl` is opened through the open-resolution OS-handoff
 * chokepoint, never fetched by the shell.
 */

/** Which release track the install follows. The value IS the wire form
 *  (string enum) so main / preload / renderer share one type. */
export enum UpdateChannel {
	Stable = "stable",
	Beta = "beta",
}

/** Outcome of a check, the single source of which UI state renders. */
export enum UpdateAvailability {
	/** Current version is ≥ the channel's latest. */
	UpToDate = "up-to-date",
	/** A newer version exists on the channel — `latest` is populated. */
	Available = "available",
	/** Couldn't determine (offline, malformed feed, no entry for the
	 *  channel). Never an error throw — a check always resolves. */
	Unknown = "unknown",
}

/** One published release on a channel. Build-time-authored, served as
 *  JSON from the release feed; parsed defensively (a malformed entry
 *  degrades to `Unknown`, never throws). */
export type ReleaseInfo = {
	readonly version: string;
	/** The human download page (GitHub release / site), opened via the
	 *  OS-handoff chokepoint. NOT a binary the shell fetches. */
	readonly downloadUrl: string;
	/** Optional short release note shown beside the download CTA. */
	readonly notes?: string;
	/** ISO date the release was published (display only). */
	readonly publishedAt?: string;
};

/** The release feed: at most one current release per channel. */
export type ReleaseFeed = {
	readonly [UpdateChannel.Stable]?: ReleaseInfo;
	readonly [UpdateChannel.Beta]?: ReleaseInfo;
};

/** Result of `update:check`, mirrored into the preload for the renderer. */
export type UpdateCheckResult = {
	readonly availability: UpdateAvailability;
	readonly channel: UpdateChannel;
	readonly currentVersion: string;
	/** Populated iff `availability === Available`. */
	readonly latest?: ReleaseInfo;
	/** ISO timestamp the check completed (display: "last checked …"). */
	readonly checkedAt: string;
};

/** Persisted, app-global (not per-vault) update preferences. */
export type UpdatePrefs = {
	readonly channel: UpdateChannel;
	/** ISO timestamp of the last successful check, or null if never. */
	readonly lastCheckedAt: string | null;
};

/** Map an arbitrary wire string back to the enum, defaulting to Stable
 *  (the safe, non-pre-release track) on anything unrecognised. */
export function toUpdateChannel(value: unknown): UpdateChannel {
	return value === UpdateChannel.Beta ? UpdateChannel.Beta : UpdateChannel.Stable;
}
