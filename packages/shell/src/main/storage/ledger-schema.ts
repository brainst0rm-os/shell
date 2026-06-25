/**
 * `ledger.db` schema — the capability ledger.
 *
 * Per docs/security/09-security-and-sandbox.md §Capabilities and
 * docs/shell/12-shell-architecture.md §Persistence layout. The IPC broker
 * consults this table on every host-service call (Stage 4); Stage 3 only
 * lands the schema so the table exists when the broker comes online.
 *
 * `capability` matches the naming convention `<service>.<verb>[:<scope>]`
 * from docs/09. `granted_via` is one of `install` | `runtime` (the user
 * approved at install vs via an explicit `capabilities.request` prompt).
 *
 * Soft delete: `revoked_at IS NULL` means the grant is live; setting it to
 * a millisecond timestamp records the revocation while keeping the audit
 * trail intact.
 */

import type { SqliteMigration } from "./migrations";

export const LEDGER_MIGRATIONS: SqliteMigration[] = [
	{
		version: 1,
		description: "ledger.db v1 — capabilities table + indexes",
		up: (db) => {
			db.exec(`
				CREATE TABLE capabilities (
					id           TEXT PRIMARY KEY,
					app_id       TEXT NOT NULL,
					capability   TEXT NOT NULL,
					scope        TEXT,
					granted_at   INTEGER NOT NULL,
					granted_via  TEXT NOT NULL CHECK (granted_via IN ('install', 'runtime')),
					revoked_at   INTEGER
				);
				CREATE INDEX idx_capabilities_app ON capabilities(app_id, capability) WHERE revoked_at IS NULL;
				CREATE INDEX idx_capabilities_active ON capabilities(app_id) WHERE revoked_at IS NULL;
			`);
		},
	},
];
