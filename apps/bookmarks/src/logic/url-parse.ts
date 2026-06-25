/**
 * URL helpers — the **on-disk URL canonicalization** the Bookmarks app
 * uses on every save + dedup. Long-term keystone — the 9.18.6
 * metadata-scrape iteration uses the same `normalizeUrl` before hashing
 * for dedup, so behaviour stays consistent.
 *
 * v1 deliberately doesn't touch query strings (no UTM-param stripping,
 * no fragment removal) — those policies are user-configurable in a
 * later iteration. The scope here is the minimum needed for "user
 * pasted a URL, save it and don't duplicate it".
 */

/** Returns the normalized form of `input` or `null` if it isn't a
 *  plausible http(s) URL. The normalization:
 *    - Trims surrounding whitespace
 *    - Prepends `https://` when the scheme is missing
 *    - Rejects anything that doesn't parse via `URL` after the prefix
 *    - Lowercases the host (the path stays case-preserving — many
 *      sites are path-case-sensitive)
 *    - Strips a trailing slash on the bare root (`https://x.com/` →
 *      `https://x.com`) but preserves trailing slashes on real paths
 *      (those can route to different content)
 */
export function normalizeUrl(input: string): string | null {
	const trimmed = input.trim();
	if (trimmed === "") return null;

	// If the input declares any scheme, it must be http or https. Without
	// this guard, `mailto:hi@x.com` would have `https://` prepended and
	// parse as a "valid" URL with host=`mailto:hi@x.com`.
	const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
	if (schemeMatch) {
		const scheme = schemeMatch[1]?.toLowerCase();
		if (scheme !== "http" && scheme !== "https") return null;
	}

	const withScheme = schemeMatch ? trimmed : `https://${trimmed}`;

	// `:///` is the empty-authority form. `new URL("https:///path")`
	// silently parses as `host=path` on some hosts, swallowing malformed
	// input. Reject upfront so callers see the rejection.
	if (/^[a-z]+:\/\/\//i.test(withScheme)) return null;

	let parsed: URL;
	try {
		parsed = new URL(withScheme);
	} catch {
		return null;
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
	if (parsed.hostname === "") return null;
	parsed.hostname = parsed.hostname.toLowerCase();
	let out = parsed.toString();
	if (out.endsWith("/") && parsed.pathname === "/" && parsed.search === "" && parsed.hash === "") {
		out = out.slice(0, -1);
	}
	return out;
}

export function isValidHttpUrl(input: string): boolean {
	return normalizeUrl(input) !== null;
}

/** Bare hostname (no port, no path). Returns `null` for malformed
 *  input — caller falls back to the raw URL string in the card. */
export function domainFromUrl(url: string): string | null {
	try {
		return new URL(url).hostname || null;
	} catch {
		return null;
	}
}

/** Deterministic 6-character hex colour derived from a string —
 *  used by the renderer to give bookmarks without a `faviconUrl` a
 *  stable per-domain colour swatch. Same-domain bookmarks always
 *  hash to the same swatch. */
export function fallbackColorFor(seed: string): string {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 16777619) >>> 0;
	}
	const r = (h >>> 16) & 0xff;
	const g = (h >>> 8) & 0xff;
	const b = h & 0xff;
	return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
