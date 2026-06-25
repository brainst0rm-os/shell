/**
 * Block-id contracts. Two distinct ids, deliberately separate:
 *
 *   - `stableBlockId(node)` — a *session*-scoped id derived from the
 *     Lexical `NodeKey`, used by editor virtualization (per
 *     docs/editing/52 §Phase 1) and the StylePack selector hooks
 *     (OQ-183). Both surfaces read `data-bs-block` from a top-level
 *     block element so they share one DOM-side hook. The height cache is
 *     a *perf cache*, not data, so a session-scoped id is sufficient: a
 *     fresh load re-measures. A fully-general persisted id on *every*
 *     block needs Lexical NodeState (lexical ≥ 0.25) and is the
 *     forward-stage `RelativePosition` concern — out of scope here.
 *
 *   - `mintBlockId()` — a *persisted* id minted once at node-creation
 *     time and stored on the node (synced through @lexical/yjs like any
 *     other instance field). Used by nodes that already carry custom
 *     state and need cross-reload, cross-device-stable identity so that
 *     *per-device* chrome (e.g. a toggle's collapsed state) can be keyed
 *     to a block without living in the synced body. This is the narrow
 *     foundation: only nodes that are already custom (ToggleNode) opt in;
 *     built-in blocks (paragraph/heading/list) still wait on NodeState.
 */

import type { LexicalNode } from "lexical";

export const BLOCK_ID_ATTR = "data-bs-block";

export function stableBlockId(node: LexicalNode): string {
	return node.getKey();
}

/** Mint a fresh persisted block id. Prefers `crypto.randomUUID()` (the
 *  renderer, Node and utilityProcess all expose it); falls back to a
 *  random base-36 string where it is absent so the editor package never
 *  hard-depends on the Web Crypto API being present. */
export function mintBlockId(): string {
	const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
	if (c?.randomUUID) return c.randomUUID();
	return `b-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}
