// One device. Imports crypto. Owns its own copy of the entity Y.Doc.
//
// Each entity Y.Doc has, persisted inside the doc itself (per
// 16-identity-orgs-encryption.md §Membership as data):
//   root.meta.wraps  — Y.Array<MemberWrapPayload>     (DEK wraps, one per device)
//   root.meta.devices — Y.Array<AddDeviceRecord>      (signed add-device records)
//   root.properties.title — Y.Text                    (the actual content)
//
// IMPORTANT: in this spike `wraps` and `devices` are kept in PLAINTEXT inside
// the doc. The doc itself is encrypted as a Yjs update under the DEK before
// it leaves the device, so the relay still doesn't see them. A future
// iteration could move them to a separate "open membership envelope" sent
// alongside the encrypted body if we want a relay-readable member set —
// the proof doc takes a position on that.

import * as Y from "yjs";

import {
	type AddDeviceRecord,
	type Ed25519KeyPair,
	type EncryptedUpdate,
	type MemberWrap,
	type X25519KeyPair,
	decryptUpdate,
	encryptUpdate,
	newDek,
	newEd25519KeyPair,
	newX25519KeyPair,
	signAddDevice,
	signEnvelope,
	unwrapDek,
	verifyAddDevice,
	verifyEnvelope,
	wrapDekFor,
} from "./crypto.ts";
import type { BlindRelay, RelayConnection } from "./relay.ts";
import {
	type Envelope,
	PROTOCOL_VERSION,
	type RoutingHeader,
	base64UrlToBytes,
	bytesToBase64Url,
	decodeFrame,
	encodeFrame,
} from "./wire.ts";

export interface ClientOptions {
	readonly deviceLabel: string;
	readonly userEd25519?: Ed25519KeyPair; // if absent, generated (=first device)
}

export class Client {
	readonly deviceLabel: string;
	readonly deviceEd25519: Ed25519KeyPair = newEd25519KeyPair();
	readonly deviceX25519: X25519KeyPair = newX25519KeyPair();
	readonly userEd25519: Ed25519KeyPair;
	readonly isFirstDevice: boolean;

	private readonly entities = new Map<string, EntityState>();
	private readonly seenSeq = new Map<string, number>(); // sender → last seen seq
	private outboundSeq = 0;
	private relay: BlindRelay | null = null;
	private incomingBuffer: Uint8Array[] = [];

	constructor(opts: ClientOptions) {
		this.deviceLabel = opts.deviceLabel;
		if (opts.userEd25519) {
			this.userEd25519 = opts.userEd25519;
			this.isFirstDevice = false;
		} else {
			this.userEd25519 = newEd25519KeyPair();
			this.isFirstDevice = true;
		}
	}

	connect(relay: BlindRelay): void {
		this.relay = relay;
		const conn: RelayConnection = {
			deviceLabel: this.deviceLabel,
			send: (frame) => this.incomingBuffer.push(frame),
		};
		relay.connect(conn);
	}

	subscribe(entityId: string): void {
		if (!this.relay) throw new Error("not connected");
		this.relay.subscribe(this.deviceLabel, entityId);
	}

	// Drain any frames the relay forwarded since the last call.
	pump(): number {
		const drained = this.incomingBuffer.length;
		const frames = this.incomingBuffer;
		this.incomingBuffer = [];
		for (const frame of frames) this.onFrame(frame);
		return drained;
	}

	// --- Entity lifecycle ---

	createEntity(entityId: string): EntityState {
		const doc = new Y.Doc();
		const root = doc.getMap("root");
		const properties = new Y.Map<unknown>();
		const meta = new Y.Map<unknown>();
		const wraps = new Y.Array<unknown>(); // MemberWrap entries serialised
		const devices = new Y.Array<unknown>(); // AddDeviceRecord entries serialised
		properties.set("title", new Y.Text(""));
		meta.set("wraps", wraps);
		meta.set("devices", devices);
		meta.set("createdAt", Date.now());
		root.set("type", "brainstorm/Note/v1");
		root.set("properties", properties);
		root.set("meta", meta);

		const dek = newDek();
		const state: EntityState = {
			entityId,
			doc,
			dek,
			knownSenders: new Map(),
		};
		this.entities.set(entityId, state);
		// First device is its own first member.
		this.attachWrap(state, this.deviceX25519);
		// The first device's add-device record is "self-signed" by the user key
		// (which on a single-device install equals the device key; here we already
		// distinguish them).
		this.appendAddDevice(state, this.deviceEd25519.pub, this.deviceX25519.pub);
		return state;
	}

	// Sender wraps the DEK under the new device's X25519 pubkey and appends
	// the wrap to the entity. Returns the freshly-attached wrap for logging.
	attachWrap(state: EntityState, recipientX25519: X25519KeyPair): MemberWrap;
	attachWrap(state: EntityState, recipientPub: Uint8Array): MemberWrap;
	attachWrap(state: EntityState, recipient: X25519KeyPair | Uint8Array): MemberWrap {
		const recipientPub = recipient instanceof Uint8Array ? recipient : recipient.pub;
		const wrap = wrapDekFor(state.dek, this.deviceX25519.secret, recipientPub);
		const wraps = (state.doc.getMap("root").get("meta") as Y.Map<unknown>).get(
			"wraps",
		) as Y.Array<unknown>;
		wraps.push([
			{
				recipientPub: bytesToBase64Url(wrap.recipientPub),
				nonce: bytesToBase64Url(wrap.nonce),
				ciphertext: bytesToBase64Url(wrap.ciphertext),
				senderX25519Pub: bytesToBase64Url(this.deviceX25519.pub),
			},
		]);
		return wrap;
	}

	// Sign and append a sovereign-user-blessed add-device record.
	appendAddDevice(
		state: EntityState,
		newDeviceEd25519Pub: Uint8Array,
		newDeviceX25519Pub: Uint8Array,
	): AddDeviceRecord {
		const record = signAddDevice(
			this.userEd25519.secret,
			newDeviceEd25519Pub,
			newDeviceX25519Pub,
			Date.now(),
		);
		const devices = (state.doc.getMap("root").get("meta") as Y.Map<unknown>).get(
			"devices",
		) as Y.Array<unknown>;
		devices.push([
			{
				newDevicePub: bytesToBase64Url(record.newDevicePub),
				newDeviceX25519Pub: bytesToBase64Url(record.newDeviceX25519Pub),
				addedAt: record.addedAt,
				sig: bytesToBase64Url(record.sig),
			},
		]);
		return record;
	}

	// Mutate the entity body. Caller passes a function that runs inside a
	// Y.Doc transaction; the resulting update bytes are encrypted and sent.
	editEntity(
		entityId: string,
		mutate: (doc: Y.Doc) => void,
	): { plaintextUpdateBytes: number; envelopeBytes: number } {
		const state = this.entities.get(entityId);
		if (!state) throw new Error(`unknown entity ${entityId}`);
		const before = Y.encodeStateAsUpdate(state.doc);
		state.doc.transact(() => mutate(state.doc), this.deviceLabel);
		const after = Y.encodeStateAsUpdate(state.doc);
		const update = Y.diffUpdate(after, Y.encodeStateVectorFromUpdate(before));
		return this.sendUpdate(state, update, "update");
	}

	// Send a full snapshot (used after pairing so a new device gets the existing
	// state). In production the relay also stores the latest encrypted snapshot
	// so a freshly-paired device can fetch it cold; the spike replays it live.
	sendSnapshot(entityId: string): { plaintextUpdateBytes: number; envelopeBytes: number } {
		const state = this.entities.get(entityId);
		if (!state) throw new Error(`unknown entity ${entityId}`);
		const update = Y.encodeStateAsUpdate(state.doc);
		return this.sendUpdate(state, update, "snapshot");
	}

	// --- Lower-level send/receive ---

	private sendUpdate(
		state: EntityState,
		plaintextUpdate: Uint8Array,
		kind: "snapshot" | "update",
	): { plaintextUpdateBytes: number; envelopeBytes: number } {
		if (!this.relay) throw new Error("not connected");
		this.outboundSeq += 1;
		const nonceBytes = new Uint8Array(24);
		crypto.getRandomValues(nonceBytes);
		const header: RoutingHeader = {
			v: PROTOCOL_VERSION,
			kind,
			entityId: state.entityId,
			sender: bytesToBase64Url(this.deviceEd25519.pub),
			seq: this.outboundSeq,
			nonce: bytesToBase64Url(nonceBytes),
			ts: Date.now(),
		};
		const headerAad = new TextEncoder().encode(JSON.stringify(header));
		// The header.nonce IS the AEAD nonce — we pass it in explicitly so the
		// header (which is the AEAD's AAD) and the AEAD's nonce stay coupled.
		// Recipient reads nonce from header, AAD from header, decrypts.
		const encrypted = encryptUpdate(state.dek, plaintextUpdate, headerAad, nonceBytes);
		const sig = signEnvelope(this.deviceEd25519.secret, header, encrypted.ciphertext);
		const envelope: Envelope = { header, ciphertext: encrypted.ciphertext, sig };
		const frame = encodeFrame(envelope);
		this.relay.ingest(this.deviceLabel, frame);
		return { plaintextUpdateBytes: plaintextUpdate.byteLength, envelopeBytes: frame.byteLength };
	}

	private onFrame(frame: Uint8Array): void {
		const env = decodeFrame(frame);
		const state = this.entities.get(env.header.entityId);

		if (!state) {
			// We received an envelope for an entity we don't yet hold (this is how
			// Bob first learns about the entity after pairing). Bootstrap a shell
			// doc and try to decrypt — we need the DEK first, which only arrives
			// once we've identified our own wrap inside the snapshot's wraps
			// array. To keep the spike legible we require the caller to call
			// `joinEntity` explicitly before subscribing on a new device.
			throw new Error(
				`received envelope for entity ${env.header.entityId} we have not joined; call joinEntity first`,
			);
		}

		if (!verifyEnvelope(env.sig, env.header, env.ciphertext, base64UrlToBytes(env.header.sender))) {
			// Forged signature; drop. (A real relay would also drop on signature,
			// but the recipient is the last line of defence.)
			return;
		}

		// Replay protection: per-sender monotonic seq within a short window.
		const lastSeen = this.seenSeq.get(env.header.sender) ?? -1;
		if (env.header.seq <= lastSeen) {
			// Either replay or out-of-order; reject. CRDTs handle out-of-order at
			// the Yjs-update layer, so duplicates are safe to drop here.
			return;
		}
		this.seenSeq.set(env.header.sender, env.header.seq);

		const headerAad = new TextEncoder().encode(JSON.stringify(env.header));
		const encrypted: EncryptedUpdate = {
			nonce: base64UrlToBytes(env.header.nonce),
			ciphertext: env.ciphertext,
		};
		const plaintextUpdate = decryptUpdate(state.dek, encrypted, headerAad);
		Y.applyUpdate(state.doc, plaintextUpdate, this.deviceLabel);
	}

	// Bob's "I've been paired" flow. The user-Ed25519 key was transferred
	// out-of-band via QR (OQ-26); the spike just passes it in via the
	// ClientOptions. Bob then asks Alice (off-band) for one envelope that
	// contains the entity's encrypted snapshot AND has a wrap addressed to
	// Bob's X25519 pubkey. The doc-layer protocol there is identical to a
	// normal `snapshot` envelope; the only special-cased thing is that Bob
	// doesn't yet hold the DEK so he decrypts via the wrap path.
	joinEntity(
		entityId: string,
		snapshotFrame: Uint8Array,
		senderUserEd25519Pub: Uint8Array,
	): EntityState {
		const env = decodeFrame(snapshotFrame);
		if (env.header.entityId !== entityId) throw new Error("entityId mismatch");
		if (!verifyEnvelope(env.sig, env.header, env.ciphertext, base64UrlToBytes(env.header.sender))) {
			throw new Error("snapshot envelope signature invalid");
		}
		// We need the plaintext Yjs update to find our wrap. Chicken/egg: the
		// wrap is INSIDE the doc that's encrypted under the DEK we don't yet
		// have. v1's resolution: a `wrap` envelope is sent BEFORE the snapshot
		// and is addressed to the recipient device — its ciphertext is the
		// raw `MemberWrap` blob, not a Yjs update; see `sendWrapTo`.
		throw new Error(
			"joinEntity called with a snapshot frame, but a `wrap` envelope must arrive first; see sendWrapTo",
		);
	}

	// Out-of-band wrap delivery. Alice, having added Bob's device, sends
	// Bob ONE special envelope whose ciphertext is the `MemberWrap` blob
	// (encrypted under the same X25519 ECDH wrap, addressed to Bob's
	// X25519 pubkey). The relay sees an envelope marked `kind=wrap`.
	// After receiving this Bob can call `bootstrapEntityFromWrap` and then
	// accept the encrypted snapshot.
	sendWrapTo(
		entityId: string,
		recipient: { devicePub: Uint8Array; deviceX25519Pub: Uint8Array; label: string },
	): { wrap: MemberWrap; envelopeBytes: number } {
		if (!this.relay) throw new Error("not connected");
		const state = this.entities.get(entityId);
		if (!state) throw new Error("unknown entity");
		const wrap = wrapDekFor(state.dek, this.deviceX25519.secret, recipient.deviceX25519Pub);
		// Encode the wrap inside the ciphertext field. (In production we'd
		// standardise this as a separate type-tagged inner blob; for the spike
		// we put it in the same envelope shape with kind="wrap" so the relay
		// sees ONE consistent on-wire shape.)
		this.outboundSeq += 1;
		const nonceBytes = new Uint8Array(24);
		crypto.getRandomValues(nonceBytes);
		const header: RoutingHeader = {
			v: PROTOCOL_VERSION,
			kind: "wrap",
			entityId,
			sender: bytesToBase64Url(this.deviceEd25519.pub),
			seq: this.outboundSeq,
			nonce: bytesToBase64Url(nonceBytes),
			ts: Date.now(),
		};
		const wrapBytes = encodeWrap(wrap, this.deviceX25519.pub);
		const sig = signEnvelope(this.deviceEd25519.secret, header, wrapBytes);
		const envelope: Envelope = { header, ciphertext: wrapBytes, sig };
		const frame = encodeFrame(envelope);
		this.relay.ingest(this.deviceLabel, frame);
		return { wrap, envelopeBytes: frame.byteLength };
	}

	// Bob's path: see a `wrap` envelope on the wire, unwrap to obtain the
	// DEK, build his local entity shell, then accept the subsequent snapshot.
	bootstrapEntityFromWrap(entityId: string, wrapFrame: Uint8Array): EntityState {
		const env = decodeFrame(wrapFrame);
		if (env.header.kind !== "wrap" || env.header.entityId !== entityId) {
			throw new Error("not a wrap envelope for this entity");
		}
		if (!verifyEnvelope(env.sig, env.header, env.ciphertext, base64UrlToBytes(env.header.sender))) {
			throw new Error("wrap envelope signature invalid");
		}
		const { wrap, senderX25519Pub } = decodeWrap(env.ciphertext);
		const dek = unwrapDek(wrap, this.deviceX25519.secret, senderX25519Pub);
		const doc = new Y.Doc();
		const state: EntityState = {
			entityId,
			doc,
			dek,
			knownSenders: new Map(),
		};
		this.entities.set(entityId, state);
		return state;
	}

	// After bootstrap, Bob can receive the encrypted snapshot via the normal
	// pump() path — his entity is already known to this client.

	// --- Helpers exposed for the proof transcript ---

	entity(entityId: string): EntityState | undefined {
		return this.entities.get(entityId);
	}

	titleOf(entityId: string): string {
		const state = this.entities.get(entityId);
		if (!state) return "";
		const props = (state.doc.getMap("root").get("properties") as Y.Map<unknown>) ?? undefined;
		if (!props) return "";
		const text = props.get("title") as Y.Text | undefined;
		return text?.toString() ?? "";
	}

	verifyAddDeviceRecords(entityId: string, userEd25519Pub: Uint8Array): boolean {
		const state = this.entities.get(entityId);
		if (!state) return false;
		const devices = (state.doc.getMap("root").get("meta") as Y.Map<unknown>)?.get("devices") as
			| Y.Array<unknown>
			| undefined;
		if (!devices) return false;
		for (const raw of devices.toArray()) {
			const r = raw as {
				newDevicePub: string;
				newDeviceX25519Pub: string;
				addedAt: number;
				sig: string;
			};
			const record: AddDeviceRecord = {
				newDevicePub: base64UrlToBytes(r.newDevicePub),
				newDeviceX25519Pub: base64UrlToBytes(r.newDeviceX25519Pub),
				addedAt: r.addedAt,
				sig: base64UrlToBytes(r.sig),
			};
			if (!verifyAddDevice(record, userEd25519Pub)) return false;
		}
		return true;
	}
}

export interface EntityState {
	readonly entityId: string;
	readonly doc: Y.Doc;
	readonly dek: Uint8Array;
	// Per-sender device pubkey trust cache (populated as add-device records
	// are verified). Not used by the spike's narrow scenario but documented
	// here as the integration point for OQ-29 audit visibility.
	readonly knownSenders: Map<string, Uint8Array>;
}

function encodeWrap(wrap: MemberWrap, senderX25519Pub: Uint8Array): Uint8Array {
	const out = new Uint8Array(32 + 24 + 48 + 32);
	out.set(wrap.recipientPub, 0);
	out.set(wrap.nonce, 32);
	out.set(wrap.ciphertext, 56);
	out.set(senderX25519Pub, 104);
	return out;
}

function decodeWrap(bytes: Uint8Array): { wrap: MemberWrap; senderX25519Pub: Uint8Array } {
	return {
		wrap: {
			recipientPub: bytes.subarray(0, 32),
			nonce: bytes.subarray(32, 56),
			ciphertext: bytes.subarray(56, 104),
		},
		senderX25519Pub: bytes.subarray(104, 136),
	};
}
