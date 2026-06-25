/**
 * `settings.db` schema — per-device, NON-synced app/UI state.
 *
 * The home for device-local state that must NOT cross devices: app view
 * preferences (Graph visual pattern, Database view config), dictionary
 * sort order, panel layout — the things that were app-private `kv.json`
 * blobs before the single-object-space collapse. Unlike `entities.db`
 * (a derived projection of the synced Y.Docs), this DB is authored
 * directly and is intentionally local — it is never part of the Yjs sync
 * set (: "SQLite indexes are
 * rebuilt on each device; the ledger and registry are per-device by
 * design" — settings joins that per-device tier).
 *
 * App-scoped by `app_id` (the broker-verified renderer identity), exactly
 * like the retired per-app kv silo, so one app can never read or clobber
 * another's settings. `value` is an opaque JSON string.
 */

import type { SqliteMigration } from "./migrations";

export const SETTINGS_MIGRATIONS: SqliteMigration[] = [
	{
		version: 1,
		description: "settings.db v1 — per-app key/value settings table",
		up: (db) => {
			db.exec(`
				CREATE TABLE settings (
					app_id  TEXT NOT NULL,
					key     TEXT NOT NULL,
					value   TEXT NOT NULL,
					PRIMARY KEY (app_id, key)
				);
				CREATE INDEX idx_settings_app ON settings(app_id);
			`);
		},
	},
];
