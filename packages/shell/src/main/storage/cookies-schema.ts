/**
 * `cookies.db` schema — Browser-10 persistent web cookie jar.
 *
 * The Browser app keeps its normal tabs in a single in-memory Chromium
 * partition (`bs-web-persist`) so nothing leaks to disk through Chromium's
 * own (OS-keyed, weak-on-Linux) cookie store. This DB is OUR persistence
 * layer for that jar: cookies are mirrored here on change and re-injected on
 * vault open. Like every other DataStore it is SQLCipher-encrypted at rest
 * under a per-DB key derived from the vault master key (HKDF) — so a session
 * token is exactly as protected as the user's own entities, and unreadable
 * while the vault is locked.
 *
 * Only NON-session cookies (those with an explicit expiration) are persisted;
 * Chromium session cookies die with the browser by definition. The primary
 * key is the RFC 6265 cookie identity tuple `(name, domain, path)`.
 *
 * Per-device and never synced — this joins the per-device tier alongside
 * `settings.db`.
 */

import type { SqliteMigration } from "./migrations";

export const COOKIES_MIGRATIONS: SqliteMigration[] = [
	{
		version: 1,
		description: "cookies.db v1 — persistent web cookie jar",
		up: (db) => {
			db.exec(`
				CREATE TABLE cookies (
					name        TEXT    NOT NULL,
					domain      TEXT    NOT NULL,
					path        TEXT    NOT NULL,
					value       TEXT    NOT NULL,
					host_only   INTEGER NOT NULL,
					secure      INTEGER NOT NULL,
					http_only   INTEGER NOT NULL,
					same_site   TEXT    NOT NULL,
					expiration  REAL    NOT NULL,
					PRIMARY KEY (name, domain, path)
				);
				CREATE INDEX idx_cookies_expiration ON cookies(expiration);
			`);
		},
	},
];
