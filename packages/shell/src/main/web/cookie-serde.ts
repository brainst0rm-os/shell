/**
 * Pure mapping between Electron's cookie shapes and the persisted
 * {@link CookieRecord} (Browser-10). Kept Electron-free (no `electron` import,
 * only structural subsets) so the whole round-trip is unit-testable; the thin
 * Electron glue that subscribes to `session.cookies` and calls `cookies.set`
 * lives in `web-cookie-jar.ts`.
 *
 * Two asymmetries this module hides:
 *   1. `cookies.get()` / the `changed` event return a `domain` + `hostOnly`,
 *      but `cookies.set()` wants a `url` — we reconstruct one from the record's
 *      scheme (`secure`), domain, and path.
 *   2. Session cookies (no `expirationDate`, or `session: true`) are NOT
 *      persistable — Chromium drops them on browser close by definition, so
 *      mirroring them would resurrect dead sessions. {@link cookieToRecord}
 *      returns `null` for those.
 */

import {
	type CookieKey,
	type CookieRecord,
	SameSitePolicy,
	toSameSitePolicy,
} from "../storage/cookie-jar-repo";

/** The subset of Electron's `Cookie` we read (from `cookies.get` and the
 *  `changed` event). Structural — Electron's richer type assigns to it. */
export interface ReadCookie {
	name: string;
	value: string;
	domain?: string;
	hostOnly?: boolean;
	path?: string;
	secure?: boolean;
	httpOnly?: boolean;
	session?: boolean;
	/** Unix seconds. Absent ⇒ a session cookie. */
	expirationDate?: number;
	sameSite?: string;
}

/** The subset of Electron's `CookiesSetDetails` we write. `url` is required by
 *  Electron; `domain` is present only for domain cookies (omitted ⇒ host-only,
 *  which is exactly how Electron re-derives `hostOnly`). */
export interface CookieSetSpec {
	url: string;
	name: string;
	value: string;
	domain?: string;
	path: string;
	secure: boolean;
	httpOnly: boolean;
	sameSite: SameSitePolicy;
	expirationDate: number;
}

/** Map a live Electron cookie to a persistable record, or `null` when it must
 *  not be persisted (session cookie, or missing the domain we key on). */
export function cookieToRecord(cookie: ReadCookie): CookieRecord | null {
	if (cookie.session === true) return null;
	if (typeof cookie.expirationDate !== "number") return null;
	if (!cookie.domain || cookie.domain.length === 0) return null;
	return {
		name: cookie.name,
		domain: cookie.domain,
		path: cookie.path && cookie.path.length > 0 ? cookie.path : "/",
		value: cookie.value,
		hostOnly: cookie.hostOnly === true,
		secure: cookie.secure === true,
		httpOnly: cookie.httpOnly === true,
		sameSite: toSameSitePolicy(cookie.sameSite ?? SameSitePolicy.Unspecified),
		expiration: cookie.expirationDate,
	};
}

/** The RFC 6265 identity of a live cookie (for the `removed` event path), or
 *  `null` if it lacks a domain. `path` defaults to `/` to match
 *  {@link cookieToRecord}. */
export function cookieKey(cookie: ReadCookie): CookieKey | null {
	if (!cookie.domain || cookie.domain.length === 0) return null;
	return {
		name: cookie.name,
		domain: cookie.domain,
		path: cookie.path && cookie.path.length > 0 ? cookie.path : "/",
	};
}

/** Reconstruct the `cookies.set` spec for a persisted record, rebuilding the
 *  `url` Electron requires from the record's scheme + host + path. */
export function recordToSetSpec(record: CookieRecord): CookieSetSpec {
	const scheme = record.secure ? "https" : "http";
	const host = record.domain.startsWith(".") ? record.domain.slice(1) : record.domain;
	const spec: CookieSetSpec = {
		url: `${scheme}://${host}${record.path}`,
		name: record.name,
		value: record.value,
		path: record.path,
		secure: record.secure,
		httpOnly: record.httpOnly,
		sameSite: record.sameSite,
		expirationDate: record.expiration,
	};
	// A domain cookie carries its domain; a host-only cookie omits it so
	// Electron re-derives hostOnly from the url's host.
	if (!record.hostOnly) spec.domain = record.domain;
	return spec;
}
