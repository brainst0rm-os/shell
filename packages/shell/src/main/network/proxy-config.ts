/**
 * Net-1d — proxy configuration keystone for the shell-mediated network
 * broker (`docs/security/38-network-and-proxy.md` §Proxy support).
 *
 * Defines the user-facing proxy config shape — system / manual / PAC /
 * direct, in that preference order — its validator, and the no-proxy
 * matcher. Per doc-38 §Decision the network broker, the update path, the
 * AI broker, the sync transport, and the embed sandbox all share **one**
 * proxy configuration; this module is the single source of truth for
 * that shape.
 *
 * Pure: no Electron imports. The session-side application (mapping the
 * config onto `Electron.Session.setProxy`) lives in
 * `network-service-handler.ts`; the keystone here stays a testable
 * value-shaped surface so the validator + matcher are exercised against
 * the full error matrix without touching Electron.
 *
 * Credentials policy. `ProxyEndpoint.authKey` is an **opaque lookup
 * key** into the per-vault credential store (`proxy.<host>:<port>` per
 * doc-29 §Network proxy credentials). The config NEVER carries an
 * inline password — a config that did would otherwise round-trip through
 * the audit log, the Settings UI, and any future config-export path.
 * Net-1e wires the credential-store side; Net-1d only validates the
 * shape and proves the value is a non-empty string.
 *
 * PAC scope. Net-1d ships the **plumbing** for PAC — mode + storage +
 * Electron `session.resolveProxy` consults the PAC URL natively — but
 * does NOT ship a custom PAC evaluator. PAC adds little until the AI
 * broker / sync transport rely on it (doc-38 §Phasing); Chromium's
 * built-in evaluator does the work when the session is set to
 * `pac_script`.
 */

import { isValidHostPattern, matchesHostPattern } from "./host-patterns";

/** Proxy mode discriminator. String values are the on-the-wire form
 *  (stable across persistence + Chromium's `mode` string), the enum keys
 *  the in-code reference per [[feedback_enums_not_string_constants]]. */
export enum ProxyMode {
	Direct = "direct",
	System = "system",
	Manual = "manual",
	Pac = "pac",
}

/** Validation error variants — one per failure mode the validator can
 *  report. Maps 1-1 to a translatable Settings → Network message in
 *  Net-1f; here we only stamp the variant so the renderer can pick
 *  the right t() id without parsing a string. */
export enum ProxyConfigError {
	MissingMode = "missing-mode",
	InvalidMode = "invalid-mode",
	MalformedEndpoint = "malformed-endpoint",
	InvalidPort = "invalid-port",
	EmptyHost = "empty-host",
	MalformedNoProxyPattern = "malformed-no-proxy-pattern",
	MalformedPacUrl = "malformed-pac-url",
	MissingPacUrl = "missing-pac-url",
}

/** Runtime error kinds for proxy resolution failures (doc-38 §Failure
 *  modes). These map onto the broker's named error shapes the same way
 *  `NetworkFetchErrorKind` does (`network-service-handler.ts` does the
 *  mapping when a `ProxyResolutionError` reaches it). */
export enum ProxyResolutionErrorKind {
	Unreachable = "proxy-unreachable",
	PacEvaluationFailed = "pac-evaluation-failed",
	AuthFailed = "proxy-auth-failed",
	TlsHandshakeFailed = "tls-handshake-failed",
}

export class ProxyResolutionError extends Error {
	override readonly name = "ProxyResolutionError";
	readonly kind: ProxyResolutionErrorKind;
	readonly detail: string;
	constructor(kind: ProxyResolutionErrorKind, detail: string) {
		super(`${kind}: ${detail}`);
		this.kind = kind;
		this.detail = detail;
	}
}

/** A single proxy endpoint (host + port + optional credential ref).
 *  `authKey` is the opaque per-vault credential-store lookup key — never
 *  an inline password. The credential store side of the lookup is
 *  Net-1e; Net-1d stores the key shape only. */
export type ProxyEndpoint = {
	readonly host: string;
	readonly port: number;
	readonly authKey?: string;
};

export type DirectProxyConfig = {
	readonly mode: ProxyMode.Direct;
};

export type SystemProxyConfig = {
	readonly mode: ProxyMode.System;
};

export type ManualProxyConfig = {
	readonly mode: ProxyMode.Manual;
	readonly httpProxy?: ProxyEndpoint;
	readonly httpsProxy?: ProxyEndpoint;
	readonly socks5Proxy?: ProxyEndpoint;
	readonly noProxy: readonly string[];
};

export type PacProxyConfig = {
	readonly mode: ProxyMode.Pac;
	readonly pacUrl: string;
};

export type ProxyConfig =
	| DirectProxyConfig
	| SystemProxyConfig
	| ManualProxyConfig
	| PacProxyConfig;

/** Result of resolving a `ProxyConfig` for a specific URL. `direct` and
 *  `http`/`https`/`socks5` are the four routes the broker emits on its
 *  own. `deferred` means the resolution requires Electron's session
 *  resolver — the broker hands the URL to `session.resolveProxy(url)`
 *  and uses whatever it returns. `system` always defers; `pac` always
 *  defers; `manual` defers only when none of its endpoints match a
 *  request that isn't covered by `noProxy`. */
export enum EffectiveProxyKind {
	Direct = "direct",
	Http = "http",
	Https = "https",
	Socks5 = "socks5",
	Deferred = "deferred",
}

export type EffectiveProxy =
	| { readonly kind: EffectiveProxyKind.Direct }
	| {
			readonly kind: EffectiveProxyKind.Http | EffectiveProxyKind.Https | EffectiveProxyKind.Socks5;
			readonly host: string;
			readonly port: number;
			readonly authKey?: string;
	  }
	| { readonly kind: EffectiveProxyKind.Deferred; readonly reason: string };

export type ProxyConfigValidationResult =
	| { readonly ok: true; readonly config: ProxyConfig }
	| { readonly ok: false; readonly error: ProxyConfigError; readonly detail: string };

/** Default config when nothing else has been wired. Matches doc-38
 *  §Decision: "Brainstorm's default is system proxy with a one-click
 *  'use direct connection' override". */
export const DEFAULT_PROXY_CONFIG: SystemProxyConfig = { mode: ProxyMode.System };

const PORT_MIN = 1;
const PORT_MAX = 65535;

/** Validate raw JSON / unknown-shaped input into a typed `ProxyConfig`.
 *  Every field strictly typechecked — missing host, non-integer port,
 *  out-of-range port, empty no-proxy pattern, etc. The caller treats a
 *  `{ ok: false }` result as a hard refuse — never silently fall back
 *  to `DEFAULT_PROXY_CONFIG` (a typo in Settings shouldn't silently
 *  ignore a user's intent to use a specific proxy). */
export function validateProxyConfig(input: unknown): ProxyConfigValidationResult {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return rejected(ProxyConfigError.MissingMode, "proxy config must be a plain object");
	}
	const raw = input as Record<string, unknown>;
	const mode = raw.mode;
	if (typeof mode !== "string" || mode.length === 0) {
		return rejected(ProxyConfigError.MissingMode, "{ mode } is required");
	}
	switch (mode) {
		case ProxyMode.Direct:
			return { ok: true, config: { mode: ProxyMode.Direct } };
		case ProxyMode.System:
			return { ok: true, config: { mode: ProxyMode.System } };
		case ProxyMode.Manual:
			return validateManual(raw);
		case ProxyMode.Pac:
			return validatePac(raw);
		default:
			return rejected(ProxyConfigError.InvalidMode, `unknown mode ${mode}`);
	}
}

function validateManual(raw: Record<string, unknown>): ProxyConfigValidationResult {
	const config: {
		mode: ProxyMode.Manual;
		httpProxy?: ProxyEndpoint;
		httpsProxy?: ProxyEndpoint;
		socks5Proxy?: ProxyEndpoint;
		noProxy: readonly string[];
	} = { mode: ProxyMode.Manual, noProxy: [] };
	for (const field of ["httpProxy", "httpsProxy", "socks5Proxy"] as const) {
		if (raw[field] === undefined) continue;
		const endpoint = validateEndpoint(raw[field]);
		if (!endpoint.ok) return endpoint;
		config[field] = endpoint.endpoint;
	}
	if (raw.noProxy !== undefined) {
		if (!Array.isArray(raw.noProxy)) {
			return rejected(
				ProxyConfigError.MalformedNoProxyPattern,
				"{ noProxy } must be an array of strings",
			);
		}
		const patterns: string[] = [];
		for (const entry of raw.noProxy as readonly unknown[]) {
			if (typeof entry !== "string" || entry.length === 0) {
				return rejected(
					ProxyConfigError.MalformedNoProxyPattern,
					"{ noProxy } entries must be non-empty strings",
				);
			}
			const pattern = entry.trim();
			if (pattern.length === 0) {
				return rejected(
					ProxyConfigError.MalformedNoProxyPattern,
					"{ noProxy } entries must be non-whitespace",
				);
			}
			if (!isValidHostPattern(pattern)) {
				return rejected(
					ProxyConfigError.MalformedNoProxyPattern,
					`{ noProxy } entry ${entry} is not a valid pattern`,
				);
			}
			patterns.push(pattern);
		}
		config.noProxy = patterns;
	}
	return { ok: true, config };
}

function validatePac(raw: Record<string, unknown>): ProxyConfigValidationResult {
	const pacUrl = raw.pacUrl;
	if (typeof pacUrl !== "string" || pacUrl.length === 0) {
		return rejected(ProxyConfigError.MissingPacUrl, "{ pacUrl } is required for pac mode");
	}
	let parsed: URL;
	try {
		parsed = new URL(pacUrl);
	} catch (_error) {
		return rejected(ProxyConfigError.MalformedPacUrl, `pacUrl ${pacUrl} is not a valid URL`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "file:") {
		return rejected(
			ProxyConfigError.MalformedPacUrl,
			`pacUrl scheme ${parsed.protocol} must be http, https, or file`,
		);
	}
	return { ok: true, config: { mode: ProxyMode.Pac, pacUrl } };
}

type EndpointValidationResult =
	| { readonly ok: true; readonly endpoint: ProxyEndpoint }
	| { readonly ok: false; readonly error: ProxyConfigError; readonly detail: string };

function validateEndpoint(input: unknown): EndpointValidationResult {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return {
			ok: false,
			error: ProxyConfigError.MalformedEndpoint,
			detail: "endpoint must be a plain object",
		};
	}
	const raw = input as Record<string, unknown>;
	const host = raw.host;
	if (typeof host !== "string" || host.trim().length === 0) {
		return {
			ok: false,
			error: ProxyConfigError.EmptyHost,
			detail: "endpoint { host } must be a non-empty string",
		};
	}
	const port = raw.port;
	if (typeof port !== "number" || !Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
		return {
			ok: false,
			error: ProxyConfigError.InvalidPort,
			detail: `endpoint { port } must be an integer in ${PORT_MIN}..${PORT_MAX}`,
		};
	}
	const endpoint: { host: string; port: number; authKey?: string } = {
		host: host.trim(),
		port,
	};
	if (raw.authKey !== undefined) {
		if (typeof raw.authKey !== "string" || raw.authKey.length === 0) {
			return {
				ok: false,
				error: ProxyConfigError.MalformedEndpoint,
				detail: "endpoint { authKey } must be a non-empty string when present",
			};
		}
		endpoint.authKey = raw.authKey;
	}
	return { ok: true, endpoint };
}

/** Match a host against the no-proxy pattern list — thin wrapper over
 *  the shared `matchesHostPattern` so the no-proxy + privacy-allowlist
 *  matchers can never drift apart. See `host-patterns.ts` for the full
 *  grammar (exact / leading-dot / leading-star / IPv4 CIDR / `*`). */
export function matchesNoProxy(host: string, patterns: readonly string[]): boolean {
	return matchesHostPattern(host, patterns);
}

/** Resolve a `ProxyConfig` against a URL into an `EffectiveProxy`. The
 *  broker uses the return value to decide whether to issue the request
 *  directly, through a known proxy, or defer to Electron's session
 *  resolver (system + PAC modes). */
export function resolveEffectiveProxy(config: ProxyConfig, url: string): EffectiveProxy {
	switch (config.mode) {
		case ProxyMode.Direct:
			return { kind: EffectiveProxyKind.Direct };
		case ProxyMode.System:
			return { kind: EffectiveProxyKind.Deferred, reason: "system proxy resolver" };
		case ProxyMode.Pac:
			return { kind: EffectiveProxyKind.Deferred, reason: "pac script evaluator" };
		case ProxyMode.Manual:
			return resolveManual(config, url);
	}
}

function resolveManual(config: ManualProxyConfig, url: string): EffectiveProxy {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch (_error) {
		// Malformed URL → fall through to direct; the broker's SSRF guard
		// catches it before any egress.
		return { kind: EffectiveProxyKind.Direct };
	}
	const host = parsed.hostname.toLowerCase();
	if (matchesNoProxy(host, config.noProxy)) {
		return { kind: EffectiveProxyKind.Direct };
	}
	if (parsed.protocol === "https:" && config.httpsProxy) {
		return endpointToEffective(EffectiveProxyKind.Https, config.httpsProxy);
	}
	if (parsed.protocol === "http:" && config.httpProxy) {
		return endpointToEffective(EffectiveProxyKind.Http, config.httpProxy);
	}
	if (config.socks5Proxy) {
		return endpointToEffective(EffectiveProxyKind.Socks5, config.socks5Proxy);
	}
	// Manual mode with no matching endpoint → direct.
	return { kind: EffectiveProxyKind.Direct };
}

function endpointToEffective(
	kind: EffectiveProxyKind.Http | EffectiveProxyKind.Https | EffectiveProxyKind.Socks5,
	endpoint: ProxyEndpoint,
): EffectiveProxy {
	if (endpoint.authKey !== undefined) {
		return { kind, host: endpoint.host, port: endpoint.port, authKey: endpoint.authKey };
	}
	return { kind, host: endpoint.host, port: endpoint.port };
}

function rejected(error: ProxyConfigError, detail: string): ProxyConfigValidationResult {
	return { ok: false, error, detail };
}
