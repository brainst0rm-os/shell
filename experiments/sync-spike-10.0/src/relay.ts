// Blind relay. THIS MODULE INTENTIONALLY IMPORTS NOTHING FROM @noble/* AND
// HAS NO REFERENCE TO ANY KEY. The blind-relay invariant is structural —
// adding a crypto import here is the regression to watch for. (CI rule for
// the real shell relay: `experiments/sync-spike-10.0/src/relay.ts` and the
// future `packages/shell/src/main/sync/relay-*.ts` must lint-fail on any
// `@noble/`, `@brainstorm/crypto`, or `keystore` import.)

import { type Envelope, type WireKind, decodeFrame } from "./wire.ts";

// The transport between clients and relay is abstract. For the spike it's
// in-process callbacks; in production it would be a WebSocket. Either way
// the relay only sees `Uint8Array` frames it forwards.
export interface RelayConnection {
	readonly deviceLabel: string; // for logging only; the relay never trusts this
	send(frame: Uint8Array): void;
}

interface PendingForward {
	readonly fromLabel: string;
	readonly entityId: string;
	readonly kind: WireKind;
	readonly bytes: number;
}

export interface RelayLogEntry {
	readonly seq: number;
	readonly ts: number;
	readonly fromLabel: string;
	readonly toLabel: string;
	readonly bytes: number;
	readonly headerSummary: string; // routing header only
	readonly hexPrefix: string; // first 48 bytes
}

export class BlindRelay {
	private readonly connections = new Map<string, RelayConnection>();
	// Routing table: entityId → set of subscribed connection labels.
	private readonly subscriptions = new Map<string, Set<string>>();
	private readonly log: RelayLogEntry[] = [];
	private seqCounter = 0;

	connect(conn: RelayConnection): void {
		this.connections.set(conn.deviceLabel, conn);
	}

	// The client tells the relay it wants envelopes for an entityId. In a real
	// deployment this would be authenticated against an org's relay-side ACL
	// (OQ-28). Personal v1: subscription is open by entity id, security comes
	// entirely from the AEAD + signature.
	subscribe(deviceLabel: string, entityId: string): void {
		let set = this.subscriptions.get(entityId);
		if (!set) {
			set = new Set<string>();
			this.subscriptions.set(entityId, set);
		}
		set.add(deviceLabel);
	}

	// Receive a framed envelope from `fromLabel` and fan-out to every other
	// subscriber for the same entityId. The relay parses ONLY the routing
	// header. It does not call any decrypt path, and it never sees a key.
	ingest(fromLabel: string, frame: Uint8Array): PendingForward {
		const env = peekHeaderOnly(frame);
		const subs = this.subscriptions.get(env.header.entityId) ?? new Set<string>();
		let forwarded = 0;
		for (const label of subs) {
			if (label === fromLabel) continue; // don't echo
			const conn = this.connections.get(label);
			if (!conn) continue;
			conn.send(frame);
			this.recordForwarded(fromLabel, label, env, frame);
			forwarded++;
		}
		return {
			fromLabel,
			entityId: env.header.entityId,
			kind: env.header.kind,
			bytes: frame.byteLength,
		};
	}

	snapshotLog(): readonly RelayLogEntry[] {
		return this.log.slice();
	}

	private recordForwarded(
		fromLabel: string,
		toLabel: string,
		env: Envelope,
		frame: Uint8Array,
	): void {
		this.seqCounter += 1;
		this.log.push({
			seq: this.seqCounter,
			ts: Date.now(),
			fromLabel,
			toLabel,
			bytes: frame.byteLength,
			headerSummary: JSON.stringify(env.header),
			hexPrefix: hexPrefix(frame, 48),
		});
	}
}

// Production note: in a real `y-websocket` deployment the relay would only
// need the entityId + sender pubkey to route, not the full header. We pass
// the whole header here to keep the spike legible — the proof doc records
// the per-field leakage so the production relay can choose what to retain.
function peekHeaderOnly(frame: Uint8Array): Envelope {
	// Yes, this reuses the wire decoder — but only to extract `header`. The
	// returned object's `ciphertext` is sliced into the same backing buffer;
	// the relay does not call any decrypt path on it.
	return decodeFrame(frame);
}

function hexPrefix(b: Uint8Array, n: number): string {
	const limit = Math.min(n, b.byteLength);
	let s = "";
	for (const byte of b.subarray(0, limit)) s += byte.toString(16).padStart(2, "0");
	return s + (b.byteLength > limit ? `…(+${b.byteLength - limit})` : "");
}
