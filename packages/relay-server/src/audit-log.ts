/**
 * Stage 10.4 — relay-server audit log.
 *
 * **Ciphertext-only invariant.** The audit log records:
 *   - `fromConnId` / `toConnId` (opaque per-connection ids; assigned by
 *     the server on handshake, no link to a user identity at v1).
 *   - `entityId` (routing key; lives in the canonical header in plaintext).
 *   - `kind` (the `WireKind` from the canonical header).
 *   - `bytes` (the wire-frame byte length).
 *   - `ts` (server-side ms timestamp).
 *
 * It MUST NOT accept the wire-frame payload bytes. The 10.9 ciphertext-
 * only proof reads this log and asserts no encrypted-body bytes appear in
 * it. The shape below is the *only* surface that records per-frame
 * activity; future ops dashboards build on `entries()` / `toJSONL()`.
 *
 * Per-line file output uses NDJSON / JSON-Lines so an external pipeline
 * (logrotate / journald / a future S3 sink) can stream events with
 * stable schema. The bin entry hooks `record` to also append a line to
 * a path the CLI specifies.
 */

// relay-blind: this file intentionally has zero crypto/credential imports.
// The CI gate covers the relay-server package; adding any forbidden
// import here requires a per-line `// relay-blind-exempt` review note.

import type { WireKind } from "./wire";

export type AuditEntry = {
	ts: number;
	fromConnId: string;
	toConnId: string;
	entityId: string;
	kind: WireKind;
	bytes: number;
};

/**
 * Constructor input — explicitly omits any payload-shaped field. Adding
 * a `payload: Uint8Array` field would breach the ciphertext-only
 * invariant; the type system enforces this is not even *possible* to
 * accidentally call.
 */
export type AuditEntryInput = {
	fromConnId: string;
	toConnId: string;
	entityId: string;
	kind: WireKind;
	bytes: number;
};

export type AuditSink = (line: string) => void;

export class AuditLog {
	readonly #entries: AuditEntry[] = [];
	readonly #sink: AuditSink | null;
	readonly #now: () => number;

	constructor(opts: { sink?: AuditSink; now?: () => number } = {}) {
		this.#sink = opts.sink ?? null;
		this.#now = opts.now ?? Date.now;
	}

	record(input: AuditEntryInput): AuditEntry {
		const entry: AuditEntry = {
			ts: this.#now(),
			fromConnId: input.fromConnId,
			toConnId: input.toConnId,
			entityId: input.entityId,
			kind: input.kind,
			bytes: input.bytes,
		};
		this.#entries.push(entry);
		if (this.#sink) {
			this.#sink(JSON.stringify(entry));
		}
		return entry;
	}

	entries(): readonly AuditEntry[] {
		return this.#entries.slice();
	}

	/** NDJSON serialisation — one entry per line. Suitable for piping to a log file. */
	toJSONL(): string {
		return this.#entries.map((e) => JSON.stringify(e)).join("\n");
	}

	clear(): void {
		this.#entries.length = 0;
	}
}
