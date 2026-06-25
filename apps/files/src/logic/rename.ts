/**
 * Inline-rename state machine.
 *
 * Four states per §Rename flow:
 *
 *   Idle ── start(id, initial) ──▶ Editing ── commit() ──▶ Committing ──▶ Idle
 *                                  │              │
 *                                  └ cancel() ────┘
 *                                  └ collision  ─▶ Confirming ──▶ Editing | Idle
 *
 * The reducer is pure; collision detection lives in `folder-tree.ts`
 * (`hasNameCollision`) and the renderer wires the two together. The
 * extension-aware initial-selection range (per UX doc: name pre-selected
 * sans extension) is computed here so tests catch off-by-one bugs.
 *
 * This is a long-term keystone — the React rewrite will wrap this in
 * `useReducer` without changing the algorithm.
 */

export enum RenameStatus {
	Idle = "idle",
	Editing = "editing",
	Confirming = "confirming",
	Committing = "committing",
}

export type RenameState =
	| { status: RenameStatus.Idle }
	| { status: RenameStatus.Editing; entityId: string; original: string; draft: string }
	| {
			status: RenameStatus.Confirming;
			entityId: string;
			original: string;
			draft: string;
	  }
	| {
			status: RenameStatus.Committing;
			entityId: string;
			original: string;
			draft: string;
	  };

export const IDLE_RENAME: RenameState = { status: RenameStatus.Idle };

export type RenameAction =
	| { kind: "start"; entityId: string; original: string }
	| { kind: "edit"; draft: string }
	| { kind: "cancel" }
	| { kind: "submit" }
	| { kind: "collision" }
	| { kind: "resolveCollision"; decision: "renameAnyway" | "cancel" }
	| { kind: "committed" };

export function renameReducer(state: RenameState, action: RenameAction): RenameState {
	switch (action.kind) {
		case "start":
			return {
				status: RenameStatus.Editing,
				entityId: action.entityId,
				original: action.original,
				draft: action.original,
			};
		case "edit":
			if (state.status !== RenameStatus.Editing) return state;
			return { ...state, draft: action.draft };
		case "cancel":
			return IDLE_RENAME;
		case "submit":
			if (state.status !== RenameStatus.Editing) return state;
			if (state.draft.trim() === "" || state.draft === state.original) return IDLE_RENAME;
			return { ...state, status: RenameStatus.Committing };
		case "collision":
			if (state.status !== RenameStatus.Committing && state.status !== RenameStatus.Editing) {
				return state;
			}
			return {
				status: RenameStatus.Confirming,
				entityId: state.entityId,
				original: state.original,
				draft: state.draft,
			};
		case "resolveCollision":
			if (state.status !== RenameStatus.Confirming) return state;
			if (action.decision === "cancel") return IDLE_RENAME;
			return {
				status: RenameStatus.Committing,
				entityId: state.entityId,
				original: state.original,
				draft: state.draft,
			};
		case "committed":
			return IDLE_RENAME;
	}
}

/**
 * Compute the pre-selected range for the inline input. For files, the
 * extension (after the last dot) stays unselected so editing the name
 * doesn't accidentally clobber it; for folders (no dot), the whole name
 * is selected. Mirrors macOS Finder / Windows Explorer behaviour.
 */
export function initialSelectionRange(name: string): { start: number; end: number } {
	const dot = name.lastIndexOf(".");
	// Treat leading dot as part of the name (e.g. ".gitignore"); only an
	// internal dot with at least one character on each side is an extension.
	if (dot > 0 && dot < name.length - 1) return { start: 0, end: dot };
	return { start: 0, end: name.length };
}
