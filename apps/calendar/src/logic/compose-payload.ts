/**
 * Pure parser for an inbound `compose` intent payload (9.15e —
 * event-create-on-click). A sibling app (or Calendar's own empty-cell
 * click, round-tripped through `intents.dispatch`) sends
 * `{ entityType, start }`; this defensively extracts the start instant
 * so a malformed / partial payload degrades to "use the caller's
 * fallback" rather than throwing or opening at NaN.
 *
 * Pure: same payload → same result. Mirrors Tasks' `parseComposePayload`.
 */

export type ComposeDraft = { start: number };

/** A finite, positive epoch-ms. Accepts a number or a numeric string
 *  (intent payloads cross a structured-clone / JSON-ish boundary). */
function asEpochMs(value: unknown): number | null {
	const n = typeof value === "string" ? Number(value) : value;
	return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

export function parseComposePayload(payload: Record<string, unknown>): ComposeDraft | null {
	// `start` is the canonical key; `defaultStart` is accepted as an alias
	// (the create surface's prop name) so callers can pass either.
	const start = asEpochMs(payload.start) ?? asEpochMs(payload.defaultStart);
	return start === null ? null : { start };
}
