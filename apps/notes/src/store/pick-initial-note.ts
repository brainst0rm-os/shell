/**
 * Pure boot-selection precedence for Notes — extracted from the app
 * mount effect so the "which note opens on launch / refresh" rule is
 * unit-testable without jsdom, Lexical, or a live runtime.
 *
 * Precedence (highest first):
 *   1. A cross-app `intent.open` carrying an entity id — the receiving
 *      app must land on the requested object.
 *   2. The note the user last had open (persisted), *if it still exists*
 *      — a renderer refresh / app relaunch returns to where they were.
 *      The existence guard makes a deleted note / vault switch /
 *      not-yet-loaded foreign-entity id degrade instead of booting blank.
 *   3. Most-recent — first-ever run, or nothing to restore.
 */

export enum InitialNoteAction {
	OpenEntity = "open-entity",
	Select = "select",
	None = "none",
}

export type InitialNotePick =
	| { action: InitialNoteAction.OpenEntity; entityId: string }
	| { action: InitialNoteAction.Select; id: string }
	| { action: InitialNoteAction.None };

export type PickInitialNoteInput = {
	/** True when the launch handshake / running-app push asked for a
	 *  specific entity (`reason === "open-entity"` with an id). */
	hasLaunchEntity: boolean;
	launchEntityId: string | null | undefined;
	/** Persisted last-open id, or `null` when nothing was stored. */
	lastOpenId: string | null;
	/** Whether an id is present in the freshly-loaded note set. */
	hasNote: (id: string) => boolean;
	/** Most-recent note id, or `null` when the vault has no notes. */
	mostRecentId: string | null;
};

export function pickInitialNote(input: PickInitialNoteInput): InitialNotePick {
	if (input.hasLaunchEntity && input.launchEntityId) {
		return { action: InitialNoteAction.OpenEntity, entityId: input.launchEntityId };
	}
	if (input.lastOpenId && input.hasNote(input.lastOpenId)) {
		return { action: InitialNoteAction.Select, id: input.lastOpenId };
	}
	if (input.mostRecentId) {
		return { action: InitialNoteAction.Select, id: input.mostRecentId };
	}
	return { action: InitialNoteAction.None };
}
