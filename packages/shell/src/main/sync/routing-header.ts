/**
 * Stage 10.3a — routing header (the metadata the blind relay reads).
 *
 * Per docs/_review/2026-05-20-10.0-sync-spike.md §3.4 the routing header is
 * the only thing visible to a blind relay; the AEAD ciphertext after it is
 * opaque. This module is the *single source* for the bytes that feed the
 * AEAD AAD and the Ed25519 signature — any drift between encode and decode
 * here would silently invalidate every envelope.
 *
 * Key invariants (load-bearing):
 *   - **Pinned key order** in `canonicalizeRoutingHeader`: `v, kind,
 *     entityId, sender, seq, nonce, ts`. The canonical bytes feed AAD and
 *     the signature, so re-ordering at write time would silently break
 *     every recipient's verify path. A property test asserts the canonical
 *     bytes are identical regardless of input-object key insertion order.
 *   - **Strict shape validation** on decode: every field present + correct
 *     type, `v === PROTOCOL_VERSION`, `kind` in the enum. Anything else
 *     throws `Invalid`.
 */

export const PROTOCOL_VERSION = 1 as const;

/**
 * Wire-kind discriminator. 10.3a only emits/accepts `Update` end-to-end;
 * the other variants are forward-declared so 10.3b doesn't churn the enum.
 * String enum per CLAUDE.md (no raw string-literal discriminators) and
 * because the wire format IS the string values.
 */
export enum WireKind {
	Update = "update",
	Snapshot = "snapshot",
	WrapBootstrap = "wrap-bootstrap",
	/**
	 * Stage 10.5c — pairing handshake transport. The relay routes by
	 * `entityId` which carries the `pairingChannelId(pairingSecret)`;
	 * the ciphertext body holds the AEAD-sealed pairing payload
	 * (sealed under `pairingSecret`, not under any entity DEK). No
	 * Yjs path is involved — the payload is the
	 * `SealedSecret` JSON for the identity-secret transfer or a
	 * plaintext target-side join packet.
	 */
	Pairing = "pairing",
	/**
	 * Stage 10.6 — transient awareness updates (cursor / presence /
	 * selection ranges). Payload = `awarenessProtocol.encodeAwarenessUpdate`
	 * bytes, AEAD-sealed under the same per-entity DEK as `Update` so the
	 * blind relay sees ciphertext only. Awareness has its own clock-based
	 * dedup (`y-protocols/awareness`), so the wire path SKIPS the
	 * `SeqTracker` replay-window for this kind.
	 */
	Awareness = "awareness",
}

export type RoutingHeader = {
	v: number;
	kind: WireKind;
	entityId: string;
	sender: string;
	seq: number;
	nonce: string;
	ts: number;
	/** Collab-C5 cross-user delivery — an OPTIONAL relay routing-key override.
	 *  When present the blind relay fans the frame to subscribers of `route`
	 *  instead of `entityId`, so a `WrapBootstrap` can reach a recipient's
	 *  per-identity *inbox* channel for an entity whose id they don't yet know
	 *  (the real `entityId` stays the AAD-bound entity). Absent ⇒ routed by
	 *  `entityId` (every existing frame; canonical bytes unchanged). Covered by
	 *  the signature, so a relay can't redirect a frame. */
	route?: string;
};

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

/**
 * Canonical bytes for `header` — JSON with a *pinned key order*. Both the
 * AEAD AAD and the Ed25519 signature are computed over these bytes; the
 * recipient re-canonicalises from the decoded header before verifying, so
 * a relay that re-orders keys at the JSON layer (or a sender that hands
 * a differently-ordered object to the codec) cannot silently break or
 * malleate the binding.
 */
export function canonicalizeRoutingHeader(header: RoutingHeader): Uint8Array {
	assertHeader(header);
	const ordered = {
		v: header.v,
		kind: header.kind,
		entityId: header.entityId,
		sender: header.sender,
		seq: header.seq,
		nonce: header.nonce,
		ts: header.ts,
		// `route` is appended LAST and only when present, so a frame without an
		// inbox override canonicalises byte-identically to the pre-C5 format.
		...(header.route ? { route: header.route } : {}),
	};
	return ENCODER.encode(JSON.stringify(ordered));
}

/** Strict-shape parse of canonical header bytes. Throws `Invalid` (named
 *  Error, kind="Invalid") on any deviation — wrong protocol version, missing
 *  field, wrong type, or unknown `kind`. */
export function parseRoutingHeaderJson(bytes: Uint8Array): RoutingHeader {
	let parsed: unknown;
	try {
		parsed = JSON.parse(DECODER.decode(bytes));
	} catch (error) {
		throw invalid(`routing header: malformed JSON (${(error as Error).message})`);
	}
	return assertHeader(parsed);
}

const KIND_SET = new Set<string>(Object.values(WireKind));

function assertHeader(value: unknown): RoutingHeader {
	if (!value || typeof value !== "object") {
		throw invalid("routing header: not an object");
	}
	const h = value as Record<string, unknown>;
	if (h.v !== PROTOCOL_VERSION) {
		throw invalid(`routing header: unsupported v=${String(h.v)} (expected ${PROTOCOL_VERSION})`);
	}
	if (typeof h.kind !== "string" || !KIND_SET.has(h.kind)) {
		throw invalid(`routing header: unknown kind=${String(h.kind)}`);
	}
	if (typeof h.entityId !== "string" || h.entityId === "") {
		throw invalid("routing header: entityId must be a non-empty string");
	}
	if (typeof h.sender !== "string" || h.sender === "") {
		throw invalid("routing header: sender must be a non-empty string");
	}
	if (typeof h.seq !== "number" || !Number.isFinite(h.seq)) {
		throw invalid("routing header: seq must be a finite number");
	}
	if (typeof h.nonce !== "string" || h.nonce === "") {
		throw invalid("routing header: nonce must be a non-empty string");
	}
	if (typeof h.ts !== "number" || !Number.isFinite(h.ts)) {
		throw invalid("routing header: ts must be a finite number");
	}
	if (h.route !== undefined && (typeof h.route !== "string" || h.route === "")) {
		throw invalid("routing header: route must be a non-empty string when present");
	}
	return {
		v: h.v,
		kind: h.kind as WireKind,
		entityId: h.entityId,
		sender: h.sender,
		seq: h.seq,
		nonce: h.nonce,
		ts: h.ts,
		...(h.route ? { route: h.route as string } : {}),
	};
}

function invalid(message: string): Error {
	const err = new Error(message);
	err.name = "Invalid";
	return err;
}
