/**
 * Pure decision for what an incoming `intent.open` should do to the
 * Preview surface. Kept framework-free so the branch logic is unit-tested
 * without a DOM (the app-side just executes the verdict).
 *
 * An originator (Files, Notes, …) may attach `context` + `siblings` to
 * drive the gallery; when both are absent we only re-focus the entity
 * within the set already on screen. A payload with neither a usable
 * entity id nor a context is a no-op (defends against a malformed /
 * verb-mismatched dispatch reaching this far).
 */

export type OpenActionPayload = {
	entityId?: unknown;
	context?: unknown;
	siblings?: unknown;
};

export type OpenAction =
	| { kind: "context"; entityId: string | undefined }
	| { kind: "focus"; entityId: string }
	| { kind: "none" };

function nonEmptyArray(value: unknown): value is ReadonlyArray<unknown> {
	return Array.isArray(value) && value.length > 0;
}

export function decideOpenAction(payload: OpenActionPayload): OpenAction {
	const entityId =
		typeof payload.entityId === "string" && payload.entityId.length > 0
			? payload.entityId
			: undefined;
	const hasContext = payload.context != null;
	if (hasContext || nonEmptyArray(payload.siblings)) {
		return { kind: "context", entityId };
	}
	if (entityId) return { kind: "focus", entityId };
	return { kind: "none" };
}
