/**
 * The Agent app's incoming-`process`-intent handling (doc 63 / AS-3 — the Agent
 * is the marquee *contributor*). When another app's menu surfaces a contributed
 * "Summarize with the agent" / "Ask the agent about this" action and the user
 * picks it, the shell dispatches `process` to the Agent; this module turns that
 * intent into a seed instruction for a fresh conversation grounded on the
 * target object (the Agent already grounds + cites via its retrieval surface).
 *
 * Pure + framework-free so the mapping is unit-testable without a runtime.
 */

/** The `kind` sub-selectors the Agent declares for `process` in its manifest.
 *  An unknown / absent kind falls back to a generic "work with this" prompt. */
export const AgentProcessKind = {
	Summarize: "summarize",
	Ask: "ask",
} as const;
export type AgentProcessKind = (typeof AgentProcessKind)[keyof typeof AgentProcessKind];

export type ProcessIntentSeed = {
	/** The seed instruction to send as the conversation's first turn. */
	instruction: string;
	/** The target entity id the instruction references (for grounding); the
	 *  Agent's retrieval pass will surface it. */
	entityId?: string;
};

/** Read a string field from an untyped intent payload. */
function str(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Build the seed for a `process` intent. The instruction is plain natural
 * language (the Agent's loop + retrieval do the grounding); when the dispatcher
 * passed a `prompt`/`text` it is used verbatim, otherwise a `kind`-specific
 * default. Returns `null` for a non-`process` verb so the caller ignores it.
 */
export function seedFromProcessIntent(
	verb: string,
	payload: Record<string, unknown>,
): ProcessIntentSeed | null {
	if (verb !== "process") return null;
	const entityId = str(payload.entityId);
	const explicit = str(payload.prompt) ?? str(payload.text);
	const kind = str(payload.kind);
	const ref = entityId ? ` (${entityId})` : "";
	let instruction: string;
	if (explicit) {
		instruction = explicit;
	} else if (kind === AgentProcessKind.Summarize) {
		instruction = `Summarize this object${ref}.`;
	} else if (kind === AgentProcessKind.Ask) {
		instruction = `I'd like to ask about this object${ref}. What can you tell me about it?`;
	} else {
		instruction = `Help me work with this object${ref}.`;
	}
	return entityId ? { instruction, entityId } : { instruction };
}
