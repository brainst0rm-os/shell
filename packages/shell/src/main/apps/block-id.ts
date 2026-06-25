/**
 * Block-id grammar — `<app-id>/<block-name>`.
 *
 * The 9.11 `blocks` host service is a "block-id → providing-app
 * registry"; every edge of it (manifest validation on install, the
 * registry resolve, `BlockEmbedNode { blockId }` lookup) needs the
 * same parse/namespace rule. It was inlined as a bare `BLOCK_ID_PATTERN`
 * regex duplicated across `manifest.ts`; centralised here so the
 * grammar has one definition and the resolver + validator can't drift.
 *
 * Leaf module (no imports) — safe for the validator, the repo, and the
 * future host-service handler to share.
 */

/** `<app-id>/<block-name>`; each segment is dot/dash/underscore-safe and
 *  contains no `/`, so the id has exactly one separator. */
export const BLOCK_ID_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export interface ParsedBlockId {
	/** Owning app id — the providing app the registry resolves to. */
	appId: string;
	/** Block name within the app's namespace. */
	name: string;
}

/** Parse a block id, or `null` when it isn't a well-formed
 *  `<app-id>/<block-name>` (non-string, empty, no/multi separator,
 *  illegal chars). */
export function parseBlockId(id: unknown): ParsedBlockId | null {
	if (typeof id !== "string" || !BLOCK_ID_PATTERN.test(id)) return null;
	const slash = id.indexOf("/");
	return { appId: id.slice(0, slash), name: id.slice(slash + 1) };
}

/** True iff `id` is a structurally valid block id. */
export function isValidBlockId(id: unknown): boolean {
	return parseBlockId(id) !== null;
}

/** True iff `id` is valid AND namespaced under `appId` (the
 *  manifest-install rule: an app may only register its own blocks). */
export function isBlockIdForApp(id: unknown, appId: string): boolean {
	const parsed = parseBlockId(id);
	return parsed !== null && parsed.appId === appId;
}

/** Build a block id from its parts. Inverse of {@link parseBlockId}
 *  for valid parts. */
export function formatBlockId(appId: string, name: string): string {
	return `${appId}/${name}`;
}
