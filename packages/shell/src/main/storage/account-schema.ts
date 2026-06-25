/**
 * `account.db` schema — the per-device cache of the commercial control plane's
 * view of this install (iteration 14.1).
 *
 * This DB is the product (data-plane) side of the billing boundary
 * (, [
 * §Commercial backend]). It holds NO vault content and NO payment details —
 * only the *account link* (which control-plane account, if any, this vault is
 * signed in as) and a cached *entitlement* (the offline-verifiable plan + feature
 * flags the client gates features on). The authoritative system-of-record lives
 * in the out-of-repo `brainstorm-cloud` control plane; this is a cache the
 * shell can read offline. v1 ships no commercial surface: the tables exist and
 * stay empty, and `BillingService` synthesises a hardcoded Free entitlement.
 *
 * Like `settings.db` and `cookies.db`, this is per-device, NON-synced state —
 * an account link and entitlement belong to the person on this device, not the
 * vault's CRDT set. A corrupt file is disposable (archive + recreate empty →
 * falls back to Free + re-fetch), so it never blocks vault open (see
 * `recovery-plan.ts`).
 *
 * The `entitlement` row mirrors the cross-plane entitlement-token claims
 * (`brainstorm-cloud/packages/api-client` §EntitlementClaims) so a future
 * control-plane refresh (14.3) can drop a verified token straight in: the
 * compact JWS `token` is retained for offline re-verification + refresh, with
 * the decoded `plan` / `features` / expiries denormalised for cheap reads.
 */

import type { SqliteMigration } from "./migrations";

export const ACCOUNT_MIGRATIONS: SqliteMigration[] = [
	{
		version: 1,
		description: "account.db v1 — account link + cached entitlement",
		up: (db) => {
			db.exec(`
				CREATE TABLE account (
					id          TEXT PRIMARY KEY,
					email       TEXT,
					plan        TEXT NOT NULL,
					linked_at   INTEGER NOT NULL,
					updated_at  INTEGER NOT NULL
				);
				CREATE TABLE entitlement (
					account_id  TEXT PRIMARY KEY,
					token       TEXT NOT NULL,
					plan        TEXT NOT NULL,
					features    TEXT NOT NULL,
					issued_at   INTEGER NOT NULL,
					soft_exp    INTEGER NOT NULL,
					hard_exp    INTEGER NOT NULL,
					cached_at   INTEGER NOT NULL
				);
			`);
		},
	},
];
