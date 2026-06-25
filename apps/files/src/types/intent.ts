/**
 * Intent verbs the Files app dispatches and handles.
 *
 * Mirrors `INTENT_VERBS` in packages/shell/src/main/apps/manifest.ts. The
 * Files app dispatches `open` (single-click navigation to non-Folder
 * entities) and `quick-look` (Space-bar peek); it handles `open`,
 * `compose`, `move`, and `quick-look` per docs/apps/42-file-manager-
 * implementation.md.
 */

export enum IntentVerb {
	Open = "open",
	QuickLook = "quick-look",
	Move = "move",
	Compose = "compose",
}

export type IntentPayload = {
	entityId?: string;
	entityType?: string;
	folderId?: string;
	memberIds?: string[];
};

export type IntentRequest = {
	verb: IntentVerb;
	payload: IntentPayload;
	source: "files";
};
