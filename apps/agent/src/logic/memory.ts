/**
 * Agent-7 — opt-in, agent-private long-term memory (scope + redaction).
 *
 * PRIVACY MODEL (the resolution this rung takes; OQ-AG-4 has no formal entry —
 * documented here as the privacy-first position):
 *
 * - **OFF by default.** {@link MEMORY_ENABLED_KEY} defaults to `false`; while
 *   disabled BOTH recall ({@link buildMemoryContextBlock} from an empty list)
 *   and writes are no-ops. Nothing of type `Memory/v1` is ever written while
 *   memory is off — the app gates every create on the enabled flag.
 * - **Consent-gated writes.** A memory is created ONLY by an explicit user
 *   action — a "remember this" affordance, or an agent-proposed fact the user
 *   confirms — never silent automatic storage of raw transcripts.
 *   {@link buildMemoryDraft} distils a salient, durable, BOUNDED fact (short
 *   text, not a transcript) for the user to review before it is written.
 * - **Agent-private.** The `Memory/v1` type is owned by the Agent app and is
 *   the only reader; it is NOT in other apps' default reads/retrieval. Writes
 *   ride the cap-checked `entities` service under the specific
 *   `entities.write:brainstorm/Memory/v1` capability — no wildcard.
 * - **Scope + redaction (user control).** Every memory is listable, editable
 *   (redactable), and deletable individually + a clear-all — the user's data
 *   under their control.
 * - **Bounded recall.** When enabled, a BOUNDED set of memories
 *   ({@link MEMORY_RECALL_TOP_K}) is injected into the turn's context, mirroring
 *   Agent-4 retrieval; fail-soft (empty list → no block).
 *
 * Everything here is pure + deterministic — no React, no DOM, no SDK runtime —
 * so the bounded / fail-soft / draft-building behaviour is unit-testable in
 * isolation.
 */

/** The `storage.kv` key holding the per-vault opt-in flag. Defaults to OFF when
 *  absent — memory is never on until the user explicitly enables it. */
export const MEMORY_ENABLED_KEY = "agent:memory-enabled";

/** Top-N memories injected into a turn's context — bounds both the prompt size
 *  and how much stored memory any single turn surfaces. */
export const MEMORY_RECALL_TOP_K = 12;

/** Hard ceiling on a single stored memory's text length — keeps a memory a
 *  short salient fact (not a pasted transcript) and bounds the recall block. */
export const MEMORY_TEXT_MAX = 280;

/** A stored long-term memory, reduced to exactly what the manager UI + recall
 *  need. Derived from a `Memory/v1` entity's properties. */
export type MemoryItem = {
	entityId: string;
	text: string;
	createdAt: string;
};

/** Coerce the persisted opt-in flag to a strict boolean — anything that isn't
 *  literally `true` reads as OFF (fail-safe: a missing / malformed value never
 *  silently enables memory). */
export function isMemoryEnabled(raw: unknown): boolean {
	return raw === true;
}

/** Normalise a candidate memory fact: collapse whitespace and clamp to
 *  {@link MEMORY_TEXT_MAX} so a memory stays a short fact. */
export function normalizeMemoryText(text: string): string {
	const collapsed = text.replace(/\s+/g, " ").trim();
	if (collapsed.length <= MEMORY_TEXT_MAX) return collapsed;
	return `${collapsed.slice(0, MEMORY_TEXT_MAX - 1).trimEnd()}…`;
}

/** The properties to write for a `Memory/v1` entity. */
export type MemoryDraft = {
	text: string;
	createdAt: string;
	source?: string;
};

/**
 * Build a `Memory/v1` draft from a selected fact. Returns `null` when the fact
 * is blank after normalisation — the caller treats that as "nothing to store"
 * (no empty memory is ever written). The `source` conversation id is provenance
 * only. Pure: the consent + persistence are the caller's (a user action).
 */
export function buildMemoryDraft(
	text: string,
	options?: { now?: string; source?: string },
): MemoryDraft | null {
	const normalized = normalizeMemoryText(text ?? "");
	if (!normalized) return null;
	const source = options?.source?.trim();
	return {
		text: normalized,
		createdAt: options?.now ?? new Date().toISOString(),
		...(source ? { source } : {}),
	};
}

/** Patch for an edit/redaction of an existing memory — the normalised new text
 *  plus an `updatedAt` stamp. Returns `null` when the new text is blank (an
 *  edit can't blank a memory; the caller deletes it instead). */
export function buildMemoryEdit(
	text: string,
	now?: string,
): { text: string; updatedAt: string } | null {
	const normalized = normalizeMemoryText(text ?? "");
	if (!normalized) return null;
	return { text: normalized, updatedAt: now ?? new Date().toISOString() };
}

/** Reduce raw `Memory/v1` entity rows to bounded {@link MemoryItem}s for the
 *  manager UI: drop blank-text rows, newest first (ids are time-sortable
 *  ULIDs). Pure. */
export function memoriesFromEntities(
	rows: readonly { id: string; properties: Record<string, unknown> }[],
): MemoryItem[] {
	const items: MemoryItem[] = [];
	for (const row of rows) {
		const text = typeof row.properties.text === "string" ? row.properties.text.trim() : "";
		if (!text) continue;
		const createdAt = typeof row.properties.createdAt === "string" ? row.properties.createdAt : "";
		items.push({ entityId: row.id, text, createdAt });
	}
	return items.sort((a, b) => (a.entityId < b.entityId ? 1 : -1));
}

/**
 * Render a bounded set of memories as a compact instruction block appended to
 * the agent's system region — mirrors Agent-4's `buildRetrievalContextBlock`.
 * Empty / disabled → empty string (the caller appends nothing, so a turn with
 * no memories degrades to ungrounded chat). Bounded by {@link MEMORY_RECALL_TOP_K}
 * and each line clamped, so a pathological store can't blow up the prompt.
 *
 * Fail-soft: never throws — a malformed item is skipped.
 */
export function buildMemoryContextBlock(
	items: readonly MemoryItem[],
	topK: number = MEMORY_RECALL_TOP_K,
): string {
	const bounded = items.slice(0, Math.max(0, topK));
	const lines: string[] = [];
	for (const item of bounded) {
		const text = normalizeMemoryText(item.text);
		if (text) lines.push(`- ${text}`);
	}
	if (lines.length === 0) return "";
	return ["What you remember about the user (from earlier conversations):", ...lines].join("\n");
}

/** Append a non-empty memory block to a base instruction, separated by a blank
 *  line. A blank block leaves the instruction untouched; a blank base yields the
 *  block alone (no leading blank lines). */
export function withMemoryContext(baseInstructions: string, block: string): string {
	if (!block) return baseInstructions;
	if (!baseInstructions) return block;
	return `${baseInstructions}\n\n${block}`;
}
