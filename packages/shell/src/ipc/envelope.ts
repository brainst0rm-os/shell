/**
 * IPC envelope shape per §IPC architecture.
 *
 *   {
 *     v: 1,                              // protocol version
 *     msg: "uuid-...",                   // correlation id
 *     app: "io.example.text-editor",     // identity stamped by preload
 *     service: "entities",
 *     method: "subscribe",
 *     args: [/* ... *],
 *     caps: ["entities.read:io.example/Note/v1"],   // hint; broker re-checks
 *   }
 *
 * The capability ledger is the source of truth — the `caps` field is a hint
 * the broker uses to fail fast on obvious mismatches, but the broker re-checks
 * against the on-disk ledger before dispatching.
 *
 * v0 (this stage): types + structural validation. No capability enforcement —
 * that lands in Stage 4 (capability ledger + IPC broker). Validation here is
 * about shape, not semantics.
 */

export const ENVELOPE_PROTOCOL_VERSION = 1 as const;

/** Reserved identifier the shell stamps on its own internal calls. */
export const SHELL_IDENTITY = "shell" as const;

/**
 * Any non-empty string with at most 256 characters is acceptable for app id.
 * App-id format (`io.example.app`) is checked at install time, not on the
 * IPC hot path.
 */
const APP_ID_PATTERN = /^[A-Za-z0-9._-]{1,256}$/;

/** Service names are lowercase ASCII identifiers, max 64 chars. */
const SERVICE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

/** Method names are camelCase ASCII identifiers, max 64 chars. */
const METHOD_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

/**
 * Correlation id (`msg`) — opaque, used to pair requests with replies. We
 * don't impose a format beyond non-empty short string; in practice the
 * broker mints ULIDs or UUIDs.
 */
const MSG_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/** Capability strings — see. */
const CAPABILITY_PATTERN = /^[a-z][a-z0-9._-]*(?::[\S]+)?$/;

export type Envelope = {
	v: typeof ENVELOPE_PROTOCOL_VERSION;
	msg: string;
	app: string;
	service: string;
	method: string;
	args: unknown[];
	caps: string[];
};

export type EnvelopeReplyOk = {
	v: typeof ENVELOPE_PROTOCOL_VERSION;
	msg: string;
	ok: true;
	value: unknown;
};

export type EnvelopeReplyError = {
	v: typeof ENVELOPE_PROTOCOL_VERSION;
	msg: string;
	ok: false;
	error: {
		kind: string;
		message: string;
		[detail: string]: unknown;
	};
};

export type EnvelopeReply = EnvelopeReplyOk | EnvelopeReplyError;

export type ValidationResult = { ok: true; envelope: Envelope } | { ok: false; reason: string };

/**
 * Validate the structural shape of an envelope. Does NOT check capabilities;
 * that's the broker's job against the on-disk ledger (Stage 4).
 *
 * Why a custom validator rather than Zod or similar: this is the hot path
 * for every IPC call. Hand-written validation is ~20× faster than schema
 * libraries and avoids pulling a runtime dependency into the preload.
 */
export function validateEnvelope(value: unknown): ValidationResult {
	if (!value || typeof value !== "object") {
		return { ok: false, reason: "envelope must be an object" };
	}
	const v = value as Record<string, unknown>;

	if (v.v !== ENVELOPE_PROTOCOL_VERSION) {
		return { ok: false, reason: `unsupported protocol version: ${String(v.v)}` };
	}
	if (typeof v.msg !== "string" || !MSG_ID_PATTERN.test(v.msg)) {
		return { ok: false, reason: "msg must be a short non-empty identifier" };
	}
	if (typeof v.app !== "string" || !APP_ID_PATTERN.test(v.app)) {
		return { ok: false, reason: "app must be a non-empty app identifier" };
	}
	if (typeof v.service !== "string" || !SERVICE_PATTERN.test(v.service)) {
		return { ok: false, reason: "service must be a lowercase identifier" };
	}
	if (typeof v.method !== "string" || !METHOD_PATTERN.test(v.method)) {
		return { ok: false, reason: "method must be an identifier" };
	}
	if (!Array.isArray(v.args)) {
		return { ok: false, reason: "args must be an array" };
	}
	if (!Array.isArray(v.caps)) {
		return { ok: false, reason: "caps must be an array" };
	}
	for (const cap of v.caps) {
		if (typeof cap !== "string" || !CAPABILITY_PATTERN.test(cap)) {
			return { ok: false, reason: `invalid capability string: ${String(cap)}` };
		}
	}

	const envelope: Envelope = {
		v: ENVELOPE_PROTOCOL_VERSION,
		msg: v.msg,
		app: v.app,
		service: v.service,
		method: v.method,
		args: v.args,
		caps: v.caps as string[],
	};
	return { ok: true, envelope };
}

export function isEnvelope(value: unknown): value is Envelope {
	return validateEnvelope(value).ok;
}

/**
 * Build an envelope from typed components. Throws if any field is malformed —
 * use this at the trusted preload (where app is stamped) and inside the
 * broker for synthesized envelopes, never with attacker-controlled input.
 */
export function makeEnvelope(parts: Omit<Envelope, "v">): Envelope {
	const candidate: Envelope = { v: ENVELOPE_PROTOCOL_VERSION, ...parts };
	const result = validateEnvelope(candidate);
	if (!result.ok) {
		throw new Error(`makeEnvelope: ${result.reason}`);
	}
	return result.envelope;
}

export function makeOkReply(msg: string, value: unknown): EnvelopeReplyOk {
	return { v: ENVELOPE_PROTOCOL_VERSION, msg, ok: true, value };
}

export function makeErrorReply(
	msg: string,
	error: { kind: string; message: string; [detail: string]: unknown },
): EnvelopeReplyError {
	return { v: ENVELOPE_PROTOCOL_VERSION, msg, ok: false, error };
}
