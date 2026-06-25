/**
 * Net-1e — shared hostname-pattern matcher + validator.
 *
 * Extracted from Net-1d's `matchesNoProxy` so the privacy-allowlist
 * (Net-1e) and the proxy no-proxy list (Net-1d) consume one matcher
 * with one set of edge-case tests. Per [[feedback_extract_to_sdk_at_copy_two]]
 * applied at the shell-internal scope: two call sites = one helper.
 *
 * Pattern grammar:
 *   - `*` — matches everything (full bypass / full allowlist).
 *   - `foo.example.com` — exact hostname match.
 *   - `.example.com` — leading-dot suffix: matches `foo.example.com`
 *     AND `example.com` itself (the conventional curl / Chromium shape
 *     no-proxy uses; the privacy allowlist follows the same convention
 *     so a user who types "include example.com and its subdomains" gets
 *     intuitive behaviour).
 *   - `*.example.com` — leading-star: matches subdomains only,
 *     NOT `example.com` itself.
 *   - `10.0.0.0/8` — CIDR: matches when `host` is a literal IPv4 in range.
 *     IPv6 is treated as a hostname (exact-string match) — a full IPv6
 *     CIDR matcher is post-v1 (rare in practice for both no-proxy and
 *     privacy allowlists).
 *
 *  Case-insensitive for hostnames; IPv4 literals matched verbatim.
 *
 *  Pure: no Electron imports, no fs, no Buffer.
 */

import { checkResolvedIp } from "./ssrf-guard";

/** Test whether `host` matches any pattern in `patterns`. */
export function matchesHostPattern(host: string, patterns: readonly string[]): boolean {
	if (patterns.length === 0) return false;
	const normalized = host.trim().toLowerCase();
	for (const raw of patterns) {
		const pattern = raw.trim().toLowerCase();
		if (pattern === "*") return true;
		if (pattern.length === 0) continue;
		if (pattern.includes("/")) {
			if (matchesCidr(normalized, pattern)) return true;
			continue;
		}
		if (pattern.startsWith("*.")) {
			const suffix = pattern.slice(1);
			if (normalized.endsWith(suffix) && normalized.length > suffix.length) return true;
			continue;
		}
		if (pattern.startsWith(".")) {
			const suffix = pattern;
			if (normalized === suffix.slice(1)) return true;
			if (normalized.endsWith(suffix)) return true;
			continue;
		}
		if (normalized === pattern) return true;
	}
	return false;
}

/** Validator-side: is `pattern` a syntactically valid host pattern under
 *  the grammar above? Used by `validateProxyConfig` (no-proxy) +
 *  `validatePrivacyConfig` (allowlist). Empty / whitespace-only refused
 *  upstream. */
export function isValidHostPattern(pattern: string): boolean {
	if (pattern === "*") return true;
	if (pattern.includes("/")) {
		const [network, prefixRaw] = pattern.split("/") as [string, string | undefined];
		if (!network || !prefixRaw) return false;
		const prefix = Number(prefixRaw);
		if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
		return parseIpv4Octets(network) !== null;
	}
	if (pattern.startsWith("*.")) {
		const rest = pattern.slice(2);
		return rest.length > 0 && isPlainHostnamePattern(rest);
	}
	if (pattern.startsWith(".")) {
		const rest = pattern.slice(1);
		return rest.length > 0 && isPlainHostnamePattern(rest);
	}
	if (parseIpv4Octets(pattern) !== null) return true;
	const ip = checkResolvedIp(pattern);
	if (ip.ok) return true;
	return isPlainHostnamePattern(pattern);
}

function matchesCidr(host: string, pattern: string): boolean {
	const [networkRaw, prefixRaw] = pattern.split("/") as [string, string | undefined];
	if (!networkRaw || !prefixRaw) return false;
	const prefix = Number(prefixRaw);
	if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
	const networkOctets = parseIpv4Octets(networkRaw);
	const hostOctets = parseIpv4Octets(host);
	if (networkOctets === null || hostOctets === null) return false;
	const networkInt = octetsToInt(networkOctets);
	const hostInt = octetsToInt(hostOctets);
	if (prefix === 0) return true;
	const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
	return (networkInt & mask) >>> 0 === (hostInt & mask) >>> 0;
}

function parseIpv4Octets(input: string): readonly number[] | null {
	const parts = input.split(".");
	if (parts.length !== 4) return null;
	const out: number[] = [];
	for (const p of parts) {
		if (!/^[0-9]+$/.test(p)) return null;
		const n = Number(p);
		if (!Number.isInteger(n) || n < 0 || n > 255) return null;
		out.push(n);
	}
	return out;
}

function octetsToInt(octets: readonly number[]): number {
	const a = octets[0] ?? 0;
	const b = octets[1] ?? 0;
	const c = octets[2] ?? 0;
	const d = octets[3] ?? 0;
	return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function isPlainHostnamePattern(input: string): boolean {
	if (input.length === 0) return false;
	if (input.length > 253) return false;
	if (!/^[a-z0-9.-]+$/i.test(input)) return false;
	if (input.startsWith(".") || input.endsWith(".")) return false;
	if (input.startsWith("-") || input.endsWith("-")) return false;
	return true;
}
