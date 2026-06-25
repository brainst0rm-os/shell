/**
 * `search.db` schema — FTS5 full-text indexes.
 *
 * Per §Schema (search.db):
 *
 *   - `entity_fts` — one row per indexed entity; plain-text content assembled
 *     from text-typed properties + Yjs rich-text plaintext.
 *   - `file_fts`   — file content index for granted folders (per OQ-37).
 *   - `help_fts`   — Help-1 corpus index (build-time-bundled curated docs).
 *     Kept separate from `entity_fts` so `services.search.query` remains
 *     semantically pure (vault content) and the help corpus can be wiped +
 *     rebuilt cheaply at every boot.
 *
 * The tokenizer is `unicode61 remove_diacritics 2` per the docs default
 * (OQ-35 deferred for v1 — language-aware tokenization arrives when
 * multilingual feedback demands).
 *
 * Vector / semantic search (Stage 11.2, OQ-61 → sqlite-vec) deliberately
 * does NOT add a migration here: its `vec0` virtual table requires the
 * sqlite-vec extension loaded on the connection, which `bun:sqlite` (and
 * any platform missing the prebuilt binary) can't do — a `CREATE VIRTUAL
 * TABLE … vec0` migration would throw "no such module: vec0" on every such
 * open. The vec0 table + its sidecar are created in `SqliteVecStore`'s
 * constructor instead (mirroring `SearchIndexer`'s sidecar DDL), which only
 * runs after a successful `loadVecExtension()`. So this list stays lexical.
 */

import type { SqliteMigration } from "./migrations";

export const SEARCH_MIGRATIONS: SqliteMigration[] = [
	{
		version: 1,
		description: "search.db v1 — entity_fts + file_fts FTS5 virtual tables",
		up: (db) => {
			db.exec(`
				CREATE VIRTUAL TABLE entity_fts USING fts5(
					entity_id UNINDEXED,
					type      UNINDEXED,
					title,
					body,
					tokenize = 'unicode61 remove_diacritics 2'
				);
			`);
			db.exec(`
				CREATE VIRTUAL TABLE file_fts USING fts5(
					file_handle_id  UNINDEXED,
					filename,
					content_excerpt,
					tokenize = 'unicode61 remove_diacritics 2'
				);
			`);
		},
	},
	{
		version: 2,
		description: "search.db v2 — help_fts FTS5 virtual table (Help-1)",
		up: (db) => {
			db.exec(`
				CREATE VIRTUAL TABLE help_fts USING fts5(
					topic_id   UNINDEXED,
					section_id UNINDEXED,
					title,
					body,
					tokenize = 'unicode61 remove_diacritics 2'
				);
			`);
		},
	},
];
