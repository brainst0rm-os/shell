/**
 * Dev-only helper: mint a fresh empty `Note/v1` entity in the active vault
 * and dispatch an `intent.open` for it. Used by the 13.4a.2 editor-keystroke
 * Playwright bench, which needs a contenteditable mounted before it can
 * measure key-to-paint — `seedDemoApps` only installs the Notes app, not any
 * note content, so without this the freshly-installed Notes opens to the
 * empty-state UI and the bench times out waiting for `[contenteditable]`.
 *
 * Wired through `dev:notes:create-and-open-scratch-note`, gated identically
 * to the rest of the `dev:*` channel surface (only registered when
 * `!app.isPackaged`). Never exposed in packaged builds.
 *
 * The note is created with `dekId: null` (a shell-internal write path).
 * That keeps the helper self-contained
 * — no dependency on the per-entity DEK store wiring — and is sufficient
 * for a bench that exercises render-path latency, not encrypted persistence.
 * The Stage 10.x `retro-wrap-deks.ts` sweeper picks `dekId: null` rows up on
 * the next vault-open, so there is no plaintext-at-rest gap beyond the
 * window between the dev IPC firing and the next sweep.
 */

import type { IntentDispatchResult, IntentsBus } from "../intents/intents-bus";
import type { EntitiesRepository } from "../storage/entities-repo";

const NOTE_TYPE = "io.brainstorm.notes/Note/v1";
const SHELL_SOURCE = "shell";

export type CreateAndOpenScratchNoteDeps = {
	getRepo: () => Promise<EntitiesRepository | null>;
	getIntents: () => IntentsBus | null | Promise<IntentsBus | null>;
	broadcastVaultEntitiesStale: () => void;
	newId?: () => string;
	now?: () => number;
};

export type CreateAndOpenScratchNoteResult =
	| { ok: true; entityId: string; dispatch: IntentDispatchResult }
	| { ok: false; reason: string };

export async function createAndOpenScratchNote(
	deps: CreateAndOpenScratchNoteDeps,
): Promise<CreateAndOpenScratchNoteResult> {
	const repo = await deps.getRepo();
	if (!repo) return { ok: false, reason: "no active vault session" };

	const bus = await deps.getIntents();
	if (!bus) return { ok: false, reason: "intents bus not ready" };

	const now = (deps.now ?? Date.now)();
	const newId =
		deps.newId ?? (() => `ent_${now.toString(36)}${Math.random().toString(36).slice(2, 10)}`);
	const entityId = newId();

	// Note shape mirrors the per-app `StoredNote` keystones the kv-entities
	// backfill uses when it projects a kv `note:` row into entities.db —
	// keeps the dev-minted row indistinguishable from a user-created one.
	const nowMs = (deps.now ?? Date.now)();
	repo.create({
		id: entityId,
		type: NOTE_TYPE,
		properties: {
			id: entityId,
			title: "",
			body: "",
			values: {},
			createdAt: nowMs,
			updatedAt: nowMs,
		},
		createdBy: SHELL_SOURCE,
		now: nowMs,
		dekId: null,
	});

	// Dispatch the open-intent FIRST, then broadcast. Order matters when a
	// Notes window is already open: broadcast-first repaints the sidebar
	// with the new entity briefly before the open-intent focuses it, which
	// flashes an unnamed row. Dispatch-first means the window is already
	// focusing the new note by the time the sidebar refreshes.
	let dispatch: IntentDispatchResult;
	try {
		dispatch = await bus.dispatch(
			{ verb: "open", payload: { entityId, entityType: NOTE_TYPE } },
			{ app: SHELL_SOURCE },
		);
	} catch (cause) {
		// Mirror `intent-handlers.ts` — never let an intent-bus throw bleed
		// through to the IPC caller. The created Note/v1 row stays
		// committed (no rollback at this layer; an orphan empty note is
		// recoverable via Bin); the caller surfaces the dispatch failure
		// instead of crashing the bench / dev workflow.
		return {
			ok: false,
			reason: `dispatch failed: ${cause instanceof Error ? cause.message : String(cause)}`,
		};
	}

	// Make any already-open Notes window pick the row up; on a cold launch
	// (the common bench case) Notes lists it on first read regardless.
	deps.broadcastVaultEntitiesStale();

	return { ok: true, entityId, dispatch };
}
