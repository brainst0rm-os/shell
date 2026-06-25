/**
 * Net-1e — per-vault privacy + per-vault proxy-override keystone for
 * the shell-mediated network broker (`docs/security/38-network-and-proxy.md`
 * §User control + §Per-vault override).
 *
 * Defines the user-facing link-preview policy (Off / On / Allowlist /
 * Manual), the privacy-strict path detector (OQ-163) that picks the
 * default for a fresh vault, and the composite `VaultNetworkSettings`
 * shape that pairs the privacy policy with an optional per-vault proxy
 * override. Per doc-38 §Decision the network broker, the update path,
 * the AI broker, the sync transport, and the embed sandbox all share
 * **one** proxy configuration; a vault-level override is the only way
 * to deviate (a home vault and a work vault can run different proxies).
 *
 * Pure: no Electron imports, no fs. The session-side application
 * (loading + persisting + emitting change events) lives in
 * `vault/vault-network-settings-store.ts` and `vault/session.ts`; the
 * keystone here stays a testable value-shaped surface so the validator,
 * allowlist matcher, and privacy-strict path detector are exercised
 * against the full error / platform matrix without touching Electron or
 * the filesystem.
 */

import { isValidHostPattern, matchesHostPattern } from "./host-patterns";
import { type ProxyConfig, type ProxyConfigError, validateProxyConfig } from "./proxy-config";

/** Link-preview policy discriminator per [[feedback_enums_not_string_constants]].
 *  String values are the on-the-wire form (stable across persistence +
 *  any future export path), the enum keys the in-code reference. */
export enum PrivacyMode {
	Off = "off",
	On = "on",
	Allowlist = "allowlist",
	Manual = "manual",
}

/** Validation error variants for `validatePrivacyConfig` /
 *  `validateVaultNetworkSettings`. Maps 1-1 to a translatable
 *  Settings → Privacy → Network message in Net-1f; here we only stamp
 *  the variant so the renderer can pick the right t() id without
 *  parsing a string. */
export enum PrivacyConfigError {
	MissingMode = "missing-mode",
	InvalidMode = "invalid-mode",
	MissingAllowlist = "missing-allowlist",
	MalformedAllowlistEntry = "malformed-allowlist-entry",
	MalformedProxyOverride = "malformed-proxy-override",
	MalformedShape = "malformed-shape",
}

/** Reason a preview attempt was refused. Surfaced via `isPreviewAllowed`
 *  + the handler's `PreviewBlocked` error so Net-1f UI can offer the
 *  right affordance (Manual → "Fetch preview" button; Off → grey out;
 *  Allowlist miss → "Add to allowlist" affordance). */
export enum PreviewBlockedReason {
	PrivacyOff = "privacy-off",
	PrivacyManual = "privacy-manual",
	PrivacyAllowlistMiss = "privacy-allowlist-miss",
}

export type OffPrivacyConfig = {
	readonly mode: PrivacyMode.Off;
};

export type OnPrivacyConfig = {
	readonly mode: PrivacyMode.On;
};

export type AllowlistPrivacyConfig = {
	readonly mode: PrivacyMode.Allowlist;
	/** Hostname-pattern allowlist; same grammar as proxy `noProxy` —
	 *  exact / leading-dot suffix / leading-star glob / IPv4 CIDR / `*`. */
	readonly hosts: readonly string[];
};

export type ManualPrivacyConfig = {
	readonly mode: PrivacyMode.Manual;
};

export type PrivacyConfig =
	| OffPrivacyConfig
	| OnPrivacyConfig
	| AllowlistPrivacyConfig
	| ManualPrivacyConfig;

/** Per-vault settings shape persisted to `<vaultPath>/shell/network-settings.json`.
 *  `proxyOverride: null` (the default) means "use the shell-wide default"
 *  (i.e. system proxy per doc-38 §Decision); a non-null value overrides
 *  that for this vault. The two halves co-locate so a vault switch flips
 *  privacy AND proxy in one atomic file read. */
export type VaultNetworkSettings = {
	readonly privacy: PrivacyConfig;
	readonly proxyOverride: ProxyConfig | null;
};

export type PrivacyConfigValidationResult =
	| { readonly ok: true; readonly config: PrivacyConfig }
	| { readonly ok: false; readonly error: PrivacyConfigError; readonly detail: string };

export type VaultNetworkSettingsValidationResult =
	| { readonly ok: true; readonly settings: VaultNetworkSettings }
	| {
			readonly ok: false;
			readonly error: PrivacyConfigError | ProxyConfigError;
			readonly detail: string;
	  };

/** Default privacy config for a normal (non-privacy-strict) vault — any
 *  URL previews. Per doc-38 §The shell's own network traffic table:
 *  "Link previews — On for normal vaults". */
export const DEFAULT_ON_PRIVACY: OnPrivacyConfig = { mode: PrivacyMode.On };

/** Default privacy config for a privacy-strict vault — no URL previews
 *  fetched. Per doc-38 §User control: "Off (default for vaults whose
 *  path matches a privacy-strict pattern — TBD per OQ-163)". */
export const DEFAULT_OFF_PRIVACY: OffPrivacyConfig = { mode: PrivacyMode.Off };

/** Privacy-strict path patterns per OQ-163. Returning true means the
 *  vault path matches a "this user wanted privacy" signal; the default
 *  privacy config flips to Off. Matching is case-insensitive on path
 *  segments and home-relative.
 *
 *  Patterns checked (any match wins):
 *    - Path segment named `Private`, `Privacy`, `Secure`, or
 *      `Confidential`.
 *    - Path segment matching `*-secure*` or `*-private*` (e.g.
 *      `work-secure-vault`, `personal-private-2026`).
 *    - Path under `~/Private/` or `~/Documents/Private/` (home-relative
 *      shortcut for users who organise sensitive content under a
 *      named root).
 *
 *  Pure: uses `path.sep`-aware splitting so macOS `/` + Windows `\`
 *  both work. Tests exercise both. */
export function isPrivacyStrictPath(vaultPath: string): boolean {
	if (typeof vaultPath !== "string" || vaultPath.length === 0) return false;
	const segments = splitPathSegments(vaultPath);
	const home = homeDirSegments();
	const homeRelative = stripHomeRelative(segments, home);

	for (const segment of segments) {
		if (isPrivacyStrictSegment(segment)) return true;
	}

	if (homeRelative) {
		const first = homeRelative[0]?.toLowerCase() ?? "";
		const second = homeRelative[1]?.toLowerCase() ?? "";
		if (first === "private") return true;
		if (first === "documents" && second === "private") return true;
	}

	return false;
}

/** Default privacy config for a fresh vault — Off for privacy-strict
 *  paths (OQ-163), On otherwise. Mirrors doc-38 §The shell's own
 *  network traffic. */
export function defaultPrivacyConfigForPath(vaultPath: string): PrivacyConfig {
	return isPrivacyStrictPath(vaultPath) ? DEFAULT_OFF_PRIVACY : DEFAULT_ON_PRIVACY;
}

/** Default per-vault network settings — privacy default for the path
 *  + no proxy override (use the shell-wide default). */
export function defaultVaultNetworkSettings(vaultPath: string): VaultNetworkSettings {
	return {
		privacy: defaultPrivacyConfigForPath(vaultPath),
		proxyOverride: null,
	};
}

/** Validate raw JSON / unknown-shaped input into a typed `PrivacyConfig`.
 *  Every field strictly typechecked. Callers treat a `{ ok: false }`
 *  result as a hard refuse — never silently fall back to a default (a
 *  typo in Settings shouldn't silently re-enable previews on a vault
 *  the user set to Off). */
export function validatePrivacyConfig(input: unknown): PrivacyConfigValidationResult {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return {
			ok: false,
			error: PrivacyConfigError.MissingMode,
			detail: "privacy config must be a plain object",
		};
	}
	const raw = input as Record<string, unknown>;
	const mode = raw.mode;
	if (typeof mode !== "string" || mode.length === 0) {
		return {
			ok: false,
			error: PrivacyConfigError.MissingMode,
			detail: "{ mode } is required",
		};
	}
	switch (mode) {
		case PrivacyMode.Off:
			return { ok: true, config: { mode: PrivacyMode.Off } };
		case PrivacyMode.On:
			return { ok: true, config: { mode: PrivacyMode.On } };
		case PrivacyMode.Manual:
			return { ok: true, config: { mode: PrivacyMode.Manual } };
		case PrivacyMode.Allowlist:
			return validateAllowlist(raw);
		default:
			return {
				ok: false,
				error: PrivacyConfigError.InvalidMode,
				detail: `unknown mode ${mode}`,
			};
	}
}

/** Validate the composite `VaultNetworkSettings` shape — privacy
 *  config + optional proxy override. */
export function validateVaultNetworkSettings(input: unknown): VaultNetworkSettingsValidationResult {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return {
			ok: false,
			error: PrivacyConfigError.MalformedShape,
			detail: "vault network settings must be a plain object",
		};
	}
	const raw = input as Record<string, unknown>;
	const privacyResult = validatePrivacyConfig(raw.privacy);
	if (!privacyResult.ok) {
		return { ok: false, error: privacyResult.error, detail: privacyResult.detail };
	}
	let proxyOverride: ProxyConfig | null = null;
	if (raw.proxyOverride !== undefined && raw.proxyOverride !== null) {
		const proxyResult = validateProxyConfig(raw.proxyOverride);
		if (!proxyResult.ok) {
			return {
				ok: false,
				error: proxyResult.error,
				detail: `proxyOverride: ${proxyResult.detail}`,
			};
		}
		proxyOverride = proxyResult.config;
	}
	return {
		ok: true,
		settings: { privacy: privacyResult.config, proxyOverride },
	};
}

/** Result of asking "is this URL allowed to preview right now?". Off
 *  and Manual always block; On always allows; Allowlist consults the
 *  host-pattern matcher. */
export type PreviewAllowedResult =
	| { readonly allowed: true }
	| { readonly allowed: false; readonly reason: PreviewBlockedReason };

export function isPreviewAllowed(config: PrivacyConfig, url: string): PreviewAllowedResult {
	switch (config.mode) {
		case PrivacyMode.Off:
			return { allowed: false, reason: PreviewBlockedReason.PrivacyOff };
		case PrivacyMode.On:
			return { allowed: true };
		case PrivacyMode.Manual:
			return { allowed: false, reason: PreviewBlockedReason.PrivacyManual };
		case PrivacyMode.Allowlist: {
			const host = hostOf(url);
			if (host === null) {
				return { allowed: false, reason: PreviewBlockedReason.PrivacyAllowlistMiss };
			}
			return matchesAllowlist(host, config.hosts)
				? { allowed: true }
				: { allowed: false, reason: PreviewBlockedReason.PrivacyAllowlistMiss };
		}
	}
}

/** Host-pattern allowlist matcher — thin wrapper over the shared
 *  `matchesHostPattern` so the privacy allowlist + proxy no-proxy
 *  matchers can never drift apart. Exported for Settings UI preview /
 *  test consumption. */
export function matchesAllowlist(host: string, patterns: readonly string[]): boolean {
	return matchesHostPattern(host, patterns);
}

function validateAllowlist(raw: Record<string, unknown>): PrivacyConfigValidationResult {
	if (raw.hosts === undefined) {
		return {
			ok: false,
			error: PrivacyConfigError.MissingAllowlist,
			detail: "{ hosts } is required for allowlist mode",
		};
	}
	if (!Array.isArray(raw.hosts)) {
		return {
			ok: false,
			error: PrivacyConfigError.MalformedAllowlistEntry,
			detail: "{ hosts } must be an array of strings",
		};
	}
	const out: string[] = [];
	for (const entry of raw.hosts as readonly unknown[]) {
		if (typeof entry !== "string" || entry.length === 0) {
			return {
				ok: false,
				error: PrivacyConfigError.MalformedAllowlistEntry,
				detail: "{ hosts } entries must be non-empty strings",
			};
		}
		const pattern = entry.trim();
		if (pattern.length === 0) {
			return {
				ok: false,
				error: PrivacyConfigError.MalformedAllowlistEntry,
				detail: "{ hosts } entries must be non-whitespace",
			};
		}
		if (!isValidHostPattern(pattern)) {
			return {
				ok: false,
				error: PrivacyConfigError.MalformedAllowlistEntry,
				detail: `{ hosts } entry ${entry} is not a valid host pattern`,
			};
		}
		out.push(pattern);
	}
	return { ok: true, config: { mode: PrivacyMode.Allowlist, hosts: out } };
}

function hostOf(url: string): string | null {
	try {
		const parsed = new URL(url);
		return parsed.hostname.toLowerCase();
	} catch (_error) {
		return null;
	}
}

function splitPathSegments(vaultPath: string): readonly string[] {
	// Honour both POSIX and Windows separators regardless of host OS so
	// the detector behaves identically on every platform under test.
	return vaultPath
		.split(/[\\/]+/)
		.map((segment) => segment.trim())
		.filter((segment) => segment.length > 0);
}

function homeDirSegments(): readonly string[] {
	const home = readHomeDir();
	if (!home) return [];
	return splitPathSegments(home);
}

function readHomeDir(): string {
	// Read via globalThis so the module stays free of `node:os` imports
	// for the test path (`process.env.HOME` is shimmed in every harness).
	const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
		?.env;
	const home = env?.HOME ?? env?.USERPROFILE ?? "";
	return typeof home === "string" ? home : "";
}

function stripHomeRelative(
	segments: readonly string[],
	home: readonly string[],
): readonly string[] | null {
	if (home.length === 0) return null;
	if (segments.length < home.length) return null;
	for (let i = 0; i < home.length; i++) {
		if (segments[i]?.toLowerCase() !== home[i]?.toLowerCase()) return null;
	}
	return segments.slice(home.length);
}

function isPrivacyStrictSegment(segment: string): boolean {
	const lower = segment.toLowerCase();
	if (lower === "private") return true;
	if (lower === "privacy") return true;
	if (lower === "secure") return true;
	if (lower === "confidential") return true;
	if (matchesGlobSuffix(lower, "-secure")) return true;
	if (matchesGlobSuffix(lower, "-private")) return true;
	return false;
}

function matchesGlobSuffix(segment: string, marker: string): boolean {
	// `*-secure*` / `*-private*`: marker can appear anywhere with at
	// least one char on the left (so `secure-vault` alone DOESN'T
	// match — the user would name an entire segment `Secure` if they
	// meant the bare word, and that segment-name path is already
	// matched above).
	const idx = segment.indexOf(marker);
	return idx > 0;
}
