/**
 * Pure helpers for the lazy `notes: string` → universal-body migration
 * (9.14.6). A task created before the inspector existed carries its
 * content in a flat `notes` string; the inspector seeds the task's
 * Y.Doc body from that string on first open and clears the legacy field
 * once the body owns the content (so there's never a moment of data
 * loss, and never two competing sources of truth).
 *
 * Kept DOM-free + Lexical-free so the conversion + the clear decision
 * are unit-testable without an editor mount.
 */

import type { SerializedEditorState } from "lexical";

type SerializedNode = {
	type: string;
	version: number;
	[key: string]: unknown;
};

function textNode(text: string): SerializedNode {
	return {
		type: "text",
		version: 1,
		detail: 0,
		format: 0,
		mode: "normal",
		style: "",
		text,
	};
}

function paragraph(children: SerializedNode[]): SerializedNode {
	return {
		type: "paragraph",
		version: 1,
		format: "",
		indent: 0,
		direction: "ltr",
		children,
	};
}

/**
 * Wrap a legacy plain-text notes string into a minimal Lexical
 * `SerializedEditorState` — one paragraph per line, empty lines
 * preserved as empty paragraphs so the structure round-trips visually.
 * A blank / whitespace-only string yields an empty root (the editor
 * shows its placeholder, nothing to plant).
 */
export function notesStringToSerializedState(notes: string): SerializedEditorState {
	const trimmed = notes.trim();
	const children: SerializedNode[] =
		trimmed.length === 0
			? []
			: notes.split("\n").map((line) => paragraph(line.length > 0 ? [textNode(line)] : []));
	return {
		root: {
			type: "root",
			version: 1,
			format: "",
			indent: 0,
			direction: "ltr",
			children,
		},
	} as unknown as SerializedEditorState;
}

/** True when a legacy `notes` string is worth seeding into the body —
 *  i.e. there's actual content to carry over. */
export function hasLegacyNotes(notes: string | undefined | null): notes is string {
	return typeof notes === "string" && notes.trim().length > 0;
}

/**
 * Decide whether the first real body edit on a task should clear its
 * legacy `notes` string. Fires once per task: only when the task still
 * carries a non-empty `notes` AND this session hasn't already migrated
 * it (the caller tracks migrated ids in a Set). The autosave plugin
 * only calls back after genuine user interaction, so a clear here means
 * the body now owns the content.
 */
export function shouldClearLegacyNotes(
	notes: string | undefined | null,
	alreadyMigrated: boolean,
): boolean {
	return !alreadyMigrated && hasLegacyNotes(notes);
}
