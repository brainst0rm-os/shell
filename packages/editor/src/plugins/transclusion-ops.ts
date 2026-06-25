/**
 * Pure-logic keystones for B6.4a transclusion (`!@` inline note embed).
 *
 *   - `detectTransclusionTrigger` — the `!@<query>` analogue of
 *     `mention-ops.ts::detectMentionTrigger`, but stricter per the
 *     B6.4a spec: `!@` opens a transclusion context **only** at
 *     start-of-line or after whitespace, never inside a word/email
 *     (so `note!@x` and `a@b!@c` never trigger).
 *   - `resolveTransclusionTarget` — the picker's cycle + depth guard:
 *     rejects self-embed, any target whose transclusion chain reaches
 *     the host (infinite recursion), and chains deeper than the budget.
 *
 * These survive the eventual Lexical `TransclusionNode` + read-only
 * sub-editor renderer (the integration half of B6.4a) — the trigger
 * grammar and the cycle math don't change when the node lands.
 */

export type TransclusionTrigger = {
	/** Offset of the `!` that opens the `!@` trigger. */
	triggerOffset: number;
	/** Substring between `!@` and the caret. */
	query: string;
};

const MAX_QUERY_LENGTH = 64;

/** Walk back from the caret for an `@` immediately preceded by `!`
 *  that opens a transclusion context. Returns `null` when the caret
 *  isn't inside one.
 *
 *  `!@` opens only when the `!` is the first character of the line OR
 *  the character before it is whitespace — never a letter/digit/
 *  punctuation (keeps `email@host`, `foo!@bar`, `x!@y` inert). */
export function detectTransclusionTrigger(text: string, caret: number): TransclusionTrigger | null {
	if (caret < 0 || caret > text.length) return null;
	for (let i = caret - 1; i >= 0; i--) {
		const ch = text.charAt(i);
		if (ch === "\n") return null;
		if (ch !== "@") continue;
		// Need a `!` immediately before the `@`.
		if (i === 0 || text.charAt(i - 1) !== "!") return null;
		const bangIndex = i - 1;
		const before = bangIndex === 0 ? "" : text.charAt(bangIndex - 1);
		if (!isTransclusionBoundary(before)) return null;
		const query = text.slice(i + 1, caret);
		if (query.length > MAX_QUERY_LENGTH) return null;
		if (/[\s\n]/.test(query)) return null;
		return { triggerOffset: bangIndex, query };
	}
	return null;
}

/** Start-of-line (or start-of-text) and post-whitespace only — the
 *  deliberately-strict B6.4a rule (mentions also allow punctuation;
 *  transclusion does not). `\n` is handled by the caller's back-scan. */
function isTransclusionBoundary(ch: string): boolean {
	return ch === "" || /\s/.test(ch);
}

/** Block vs inline form of a `!@` transclusion (B11.1). A `!@` opened at the
 *  start of an otherwise-empty line inserts the block card; one opened mid-line
 *  (after existing text) inserts the compact inline card-preview mark, so a
 *  reference inside a sentence doesn't split the paragraph. */
export enum TransclusionPlacement {
	Block = "block",
	Inline = "inline",
}

/** Decide block vs inline from whether the `!@` trigger sits at the very start
 *  of its block (the trigger's text node is the block's first child and the
 *  `!` is at offset 0). Pure so the placement rule is proven without a live
 *  editor; the plugin computes `atBlockStart` from the Lexical selection. */
export function resolveTransclusionPlacement(atBlockStart: boolean): TransclusionPlacement {
	return atBlockStart ? TransclusionPlacement.Block : TransclusionPlacement.Inline;
}

export enum TransclusionRejectReason {
	/** Target is the host note itself. */
	Self = "self",
	/** Target's transclusion chain reaches the host (or loops). */
	Cycle = "cycle",
	/** The resulting chain is deeper than the budget. */
	Depth = "depth",
}

export type TransclusionVerdict = { ok: true } | { ok: false; reason: TransclusionRejectReason };

/** Default max transclusion nesting before render collapses to an
 *  "↪ Open in source" affordance (per B6.4a). */
export const MAX_TRANSCLUSION_DEPTH = 10;

/**
 * May `host` embed `target`? `childrenOf(id)` returns the entity ids a
 * note *already* transcludes (its outgoing transclusion edges, not
 * including the prospective `host → target` one being evaluated).
 *
 * Rejects, in priority order: `Self` (target === host); `Cycle` (a DFS
 * from `target` reaches `host`, or hits an existing loop in the graph);
 * `Depth` (a transclusion path from `target` would push total nesting
 * past `maxDepth` — host counts as level 1).
 */
export function resolveTransclusionTarget(
	hostId: string,
	targetId: string,
	childrenOf: (id: string) => readonly string[],
	maxDepth: number = MAX_TRANSCLUSION_DEPTH,
): TransclusionVerdict {
	if (targetId === hostId) {
		return { ok: false, reason: TransclusionRejectReason.Self };
	}

	let depthExceeded = false;
	const stack = new Set<string>();

	// `depth` is the nesting level of `node` measured from the host:
	// host = 0, target = 1, target's child = 2, …
	function visit(node: string, depth: number): boolean /* cycle found */ {
		if (node === hostId) return true; // chain loops back to the host
		if (stack.has(node)) return true; // pre-existing cycle in the graph
		if (depth > maxDepth) {
			depthExceeded = true;
			return false;
		}
		stack.add(node);
		for (const child of childrenOf(node)) {
			if (visit(child, depth + 1)) return true;
		}
		stack.delete(node);
		return false;
	}

	if (visit(targetId, 1)) {
		return { ok: false, reason: TransclusionRejectReason.Cycle };
	}
	if (depthExceeded) {
		return { ok: false, reason: TransclusionRejectReason.Depth };
	}
	return { ok: true };
}

/** What a TransclusionNode renderer should do for a given target, decided
 *  against the live render chain (B6.4b). */
export enum TransclusionRenderDecision {
	/** Safe to paint the target's body inline. */
	Render = "render",
	/** Target is already an ancestor in the render chain — painting it would
	 *  recurse forever. Collapse to an "↪ open in source" affordance. */
	CycleElided = "cycle-elided",
	/** The render chain is already at the depth budget. Collapse likewise. */
	DepthElided = "depth-elided",
}

/**
 * Render-time guard for a TransclusionNode (B6.4b). The picker's
 * `resolveTransclusionTarget` vets *insertion* against the forward graph,
 * but a hand-edited / imported / concurrently-synced body can smuggle a
 * cycle past it — so the renderer re-checks against the LIVE **ancestor
 * chain**: the entity ids being transcluded *above* this node (the host
 * note first, then each nested transclusion down to the immediate parent),
 * NOT including `targetId` itself.
 *
 * A target already in the chain would recurse forever → `CycleElided`. A
 * chain already `maxDepth` deep collapses → `DepthElided`. Otherwise the
 * body is safe to paint → `Render`. Pure so the depth/cycle math is proven
 * without mounting the nested read-only editor.
 */
export function decideTransclusionRender(
	ancestorChain: readonly string[],
	targetId: string,
	maxDepth: number = MAX_TRANSCLUSION_DEPTH,
): TransclusionRenderDecision {
	if (ancestorChain.includes(targetId)) return TransclusionRenderDecision.CycleElided;
	if (ancestorChain.length >= maxDepth) return TransclusionRenderDecision.DepthElided;
	return TransclusionRenderDecision.Render;
}
