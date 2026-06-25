/**
 * Stage 10.5c — pairing live E2E + revoke enforcement.
 *
 * Two `mkdtemp`-isolated `VaultSession`s + a `createRelayCore()`
 * relay-server core driven via in-process handlers (the same handler
 * surface `Bun.serve` calls in production). The clients use a custom
 * `WebSocketCtor` that wires them straight into the relay-server's
 * `ServerWebSocketLike` interface — no actual `Bun.serve` socket, but
 * the binary wire format crosses through it untouched, so any
 * relay-server frame parse / routing regression catches.
 *
 * Steps:
 *   1. A1 calls `startQrHandshakeOnSource` → QR payload, pairing
 *      channel id, SAS.
 *   2. A2 calls into the same channel: requests sealed identity over
 *      the live wire.
 *   3. The pipeline routes a `JoinRequest` (A2 → A1) and a
 *      `SealedIdentity` (A1 → A2) through the relay's routing-header
 *      `entityId === pairingChannelId`.
 *   4. A2 unseals via `importSecretSealed` + verifies pubkey match.
 *   5. A2 signs an `add-device` record. A1 signs the same record on
 *      its side (in v1 the records converge by deviceEd25519Pub
 *      idempotency).
 *   6. Revoke: A1 calls `devicesStore.revoke(A2.deviceEd25519Pub)`. A
 *      subsequent encrypted update from A2's pubkey is dropped by A1's
 *      pipeline verifier as `Revoked` BEFORE sig-verify runs.
 *   7. The relay's audit log shows zero plaintext bytes from the CRDT
 *      path (the sealed identity bytes are AEAD ciphertext under
 *      `pairingSecret`).
 */

import { Buffer } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ServerWebSocketLike, createRelayCore } from "../../../../relay-server/src/server";
import { XCHACHA_NONCE_BYTES, bytesToBase64 } from "../credentials/crypto";
import {
	PairingChannelGuard,
	exportSecretSealed,
	importSecretSealed,
} from "../credentials/identity-export";
import { DevicesStore, signAddDeviceRecord } from "../pairing/devices-store";
import { bytesToBase64Url } from "../pairing/pairing-channel";
import {
	PairingFrameType,
	decodePairingFrame,
	encodePairingFrame,
	verifyPairingFrame,
} from "../pairing/pairing-frame";
import { startQrHandshakeOnSource } from "../pairing/pairing-handshake";
import { ed25519 } from "../test-support/crypto-test-helpers";
import { VaultSession } from "../vault/session";
import { type PipelineContext, encryptAndEmit, receiveAndApply } from "./envelope-pipeline";
import { type WebSocketLike, WebSocketRelayPort } from "./websocket-relay-port";

const ENTITY_ID = "ent_pair_live";

/**
 * Wire two `WebSocketRelayPort`s into a `createRelayCore()` via a fake
 * WebSocket impl that delegates onmessage / send directly to the relay
 * handlers. Mirrors the relay-server test pattern but inverts who's
 * calling whom.
 */
class FakeWebSocket implements WebSocketLike {
	readyState = 0; // Connecting until open fires.
	onopen: (() => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: ((e?: unknown) => void) | null = null;
	onmessage: ((e: { data: unknown }) => void) | null = null;
	private serverWs: ServerWebSocketLike;
	private core: ReturnType<typeof createRelayCore>;

	constructor(core: ReturnType<typeof createRelayCore>) {
		this.core = core;
		const self = this;
		this.serverWs = {
			send(data: Uint8Array | string): void {
				if (self.onmessage && data instanceof Uint8Array) {
					// Defensive copy + setTimeout 0 so cross-port deliveries
					// always cross at least one macrotask boundary (matches
					// real-WebSocket semantics).
					const copy = new Uint8Array(data);
					setTimeout(() => self.onmessage?.({ data: copy }), 0);
				}
			},
			close(): void {
				self.readyState = 3;
			},
			data: {},
		};
		// Open on the next macrotask so the WebSocketRelayPort can set
		// onopen/onmessage before they fire.
		setTimeout(() => {
			this.readyState = 1;
			this.core.handlers.onOpen(this.serverWs);
			this.onopen?.();
		}, 0);
	}

	send(data: Uint8Array): void {
		// Forward to the relay's onMessage. Defensive copy mirrors what a
		// real WebSocket impl does at the OS boundary.
		const copy = new Uint8Array(data);
		setTimeout(() => this.core.handlers.onMessage(this.serverWs, copy), 0);
	}

	close(): void {
		if (this.readyState === 3) return;
		this.readyState = 3;
		this.core.handlers.onClose(this.serverWs);
		this.onclose?.();
	}
}

function freshNonce(): Uint8Array {
	const n = new Uint8Array(XCHACHA_NONCE_BYTES);
	crypto.getRandomValues(n);
	return n;
}

function makeCtx(args: {
	session: VaultSession;
	port: { send: (frame: Uint8Array) => void };
	dekStore: unknown;
	resolveEntity: (id: string) => { id: string; type: string } | null;
	isDeviceRevoked?: (sender: Uint8Array) => boolean;
}): PipelineContext {
	let seq = 0;
	const ctx: PipelineContext = {
		dekStore: args.dekStore as never,
		devicePub: args.session.identity.publicKey,
		deviceSign: (bytes: Uint8Array) => args.session.signPayload(bytes),
		deviceVerify: (sig, bytes, senderPub) => {
			try {
				return ed25519.verify(sig, bytes, senderPub);
			} catch {
				return false;
			}
		},
		resolveEntity: args.resolveEntity,
		relay: {
			send: (f: Uint8Array) => args.port.send(f),
			onFrame: () => undefined,
			offFrame: () => undefined,
			close: () => undefined,
		},
		nextSeq: () => seq++,
		nowMs: () => Date.now(),
		randomNonce: () => freshNonce(),
	};
	if (args.isDeviceRevoked) ctx.isDeviceRevoked = args.isDeviceRevoked;
	return ctx;
}

async function flushMicrotasks(): Promise<void> {
	for (let i = 0; i < 8; i++) {
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	}
}

describe("pairing live E2E (Stage 10.5c)", () => {
	let dirA: string;
	let dirB: string;

	beforeEach(async () => {
		dirA = await mkdtemp(join(tmpdir(), "bs-pair-A-"));
		dirB = await mkdtemp(join(tmpdir(), "bs-pair-B-"));
	});

	afterEach(async () => {
		await rm(dirA, { recursive: true, force: true });
		await rm(dirB, { recursive: true, force: true });
	});

	it("source ↔ target pairing handshake completes over a real relay-core; sealed identity matches", async () => {
		const auditEntries: string[] = [];
		const core = createRelayCore({ auditSink: (line) => auditEntries.push(line) });

		const sessionA = await VaultSession.create({
			vaultId: "vlt_A",
			vaultPath: dirA,
			forceInsecure: true,
		});
		const sessionB = await VaultSession.create({
			vaultId: "vlt_B",
			vaultPath: dirB,
			forceInsecure: true,
		});

		try {
			// 1) Source builds a QR payload.
			const sourceIdentityExposed = sessionA.exposeIdentityForPairing();
			const qr = startQrHandshakeOnSource({
				userEd25519Pub: sourceIdentityExposed.publicKey,
				userEd25519Sec: sourceIdentityExposed.secretKey,
				sourceDeviceEd25519Pub: sourceIdentityExposed.deviceEd25519Public,
				relayUrl: "ws://test-relay",
			});

			// 2) Both sides open a WebSocketRelayPort wired to the same
			//    in-process relay core. `wsImpl` is invoked via `new` —
			//    must be a real constructor, not an arrow function. We
			//    bind the core via a class.
			class WiredWS extends FakeWebSocket {
				constructor(_url: string) {
					super(core);
				}
			}
			const portA = new WebSocketRelayPort({
				url: "ws://test-relay",
				wsImpl: WiredWS as never,
			});
			const portB = new WebSocketRelayPort({
				url: "ws://test-relay",
				wsImpl: WiredWS as never,
			});
			portA.connect();
			portB.connect();
			await flushMicrotasks();

			portA.subscribe(qr.channelId);
			portB.subscribe(qr.channelId);
			await flushMicrotasks();

			// 3) Target (B) sends a JoinRequest + waits for SealedIdentity.
			const targetIdentityExposed = sessionB.exposeIdentityForPairing();
			let resolveSealed: ((sealed: { v: 1; nonceB64: string; ciphertextB64: string }) => void) | null =
				null;
			const sealedFromSource = new Promise<{ v: 1; nonceB64: string; ciphertextB64: string }>(
				(resolve) => {
					resolveSealed = resolve;
				},
			);
			portB.onFrame((frame) => {
				try {
					const decoded = decodePairingFrame(frame);
					if (decoded.body.type !== PairingFrameType.SealedIdentity) return;
					if (!verifyPairingFrame(decoded, sourceIdentityExposed.deviceEd25519Public)) return;
					const parsed = JSON.parse(Buffer.from(decoded.body.sealed, "base64").toString("utf8"));
					resolveSealed?.(parsed);
				} catch {
					// Not for us — drop.
				}
			});

			// 4) Source listens for JoinRequest, replies with the AEAD-sealed identity.
			portA.onFrame((frame) => {
				try {
					const decoded = decodePairingFrame(frame);
					if (decoded.body.type !== PairingFrameType.JoinRequest) return;
					// Seal identity under pairingSecret + reply.
					const sealed = exportSecretSealed(sourceIdentityExposed.secretKey, qr.pairingSecret);
					const sealedJson = Buffer.from(JSON.stringify(sealed), "utf8").toString("base64");
					const reply = encodePairingFrame({
						channelId: qr.channelId,
						body: {
							type: PairingFrameType.SealedIdentity,
							sealed: sealedJson,
							sourceDeviceEd25519Pub: bytesToBase64Url(sourceIdentityExposed.deviceEd25519Public),
						},
						deviceEd25519Pub: sourceIdentityExposed.deviceEd25519Public,
						deviceEd25519Secret: sourceIdentityExposed.deviceEd25519Secret,
						seq: 0,
						nowMs: Date.now(),
						nonce: bytesToBase64(freshNonce()),
					});
					portA.send(reply);
				} catch {
					// noise
				}
			});

			// 5) Target sends JoinRequest.
			const joinReq = encodePairingFrame({
				channelId: qr.channelId,
				body: {
					type: PairingFrameType.JoinRequest,
					deviceEd25519Pub: bytesToBase64Url(targetIdentityExposed.deviceEd25519Public),
					deviceX25519Pub: bytesToBase64Url(targetIdentityExposed.deviceX25519Public),
					deviceLabel: "Target Device",
				},
				deviceEd25519Pub: targetIdentityExposed.deviceEd25519Public,
				deviceEd25519Secret: targetIdentityExposed.deviceEd25519Secret,
				seq: 0,
				nowMs: Date.now(),
				nonce: bytesToBase64(freshNonce()),
			});
			portB.send(joinReq);

			// 6) Wait for the sealed-identity reply.
			const sealed = await sealedFromSource;
			expect(sealed.v).toBe(1);
			expect(sealed.nonceB64.length).toBeGreaterThan(0);
			expect(sealed.ciphertextB64.length).toBeGreaterThan(0);

			// 7) Target unseals + verifies pubkey matches the QR-known
			//    user-Ed25519 pubkey.
			const guard = new PairingChannelGuard();
			expect(guard.consume(qr.pairingSecret)).toBe(true);
			const identitySecret = importSecretSealed(sealed, qr.pairingSecret);
			expect(identitySecret.length).toBe(32);
			// The unsealed identity must match the source's identity pubkey.
			const recoveredPub = new Uint8Array(ed25519.getPublicKey(identitySecret));
			expect(Buffer.from(recoveredPub).toString("base64")).toBe(
				Buffer.from(sourceIdentityExposed.publicKey).toString("base64"),
			);

			// 8) Both sides write a (converging) add-device record. v1
			//    DevicesStore.add is idempotent by deviceEd25519Pub so the
			//    record converges regardless of who writes first.
			const recordOnA = signAddDeviceRecord(
				{
					deviceEd25519Pub: bytesToBase64(targetIdentityExposed.deviceEd25519Public),
					deviceX25519Pub: bytesToBase64(targetIdentityExposed.deviceX25519Public),
					deviceLabel: "Target Device",
					addedAt: Date.now(),
					addedBy: bytesToBase64(sourceIdentityExposed.publicKey),
				},
				sourceIdentityExposed.secretKey,
			);
			const recordOnB = signAddDeviceRecord(
				{
					deviceEd25519Pub: bytesToBase64(targetIdentityExposed.deviceEd25519Public),
					deviceX25519Pub: bytesToBase64(targetIdentityExposed.deviceX25519Public),
					deviceLabel: "Target Device",
					addedAt: recordOnA.addedAt, // matched timestamp so signatures converge
					addedBy: bytesToBase64(sourceIdentityExposed.publicKey), // same user-Ed25519
				},
				identitySecret,
			);
			// Same canonical bytes → same signature (signing is deterministic
			// in Ed25519).
			expect(recordOnA.sig).toBe(recordOnB.sig);

			// 9) Audit log saw zero plaintext identity-secret bytes. The
			//    32-byte identitySecret should not appear hex-encoded in any
			//    audit-log line; nor should the source's user-Ed25519 secret.
			const identityHex = Buffer.from(identitySecret).toString("hex");
			const sourceSecHex = Buffer.from(sourceIdentityExposed.secretKey).toString("hex");
			for (const line of auditEntries) {
				expect(line.includes(identityHex)).toBe(false);
				expect(line.includes(sourceSecHex)).toBe(false);
			}

			portA.close();
			portB.close();
			identitySecret.fill(0);
		} finally {
			sessionA.dispose();
			sessionB.dispose();
		}
	}, 15_000);

	it("revoke drops a sender's envelope on the cheap path (sig-verify never runs)", async () => {
		// We don't need the relay here — the pipeline contract is what we're
		// testing — but we use a real VaultSession on both sides so the
		// device pubkeys are real, and the DevicesStore.isRevoked predicate
		// drives the verifier.
		const sessionA = await VaultSession.create({
			vaultId: "vlt_revA",
			vaultPath: dirA,
			forceInsecure: true,
		});
		const sessionB = await VaultSession.create({
			vaultId: "vlt_revB",
			vaultPath: dirB,
			forceInsecure: true,
		});
		try {
			// Build a vault-properties-style doc just to host the DevicesStore.
			const Y = await import("yjs");
			const doc = new Y.Doc();
			DevicesStore.ensureRoot(doc);
			const devicesStore = new DevicesStore(doc);

			// Add B's device, then revoke it.
			const exposedB = sessionB.exposeIdentityForPairing();
			const exposedA = sessionA.exposeIdentityForPairing();
			const record = signAddDeviceRecord(
				{
					deviceEd25519Pub: bytesToBase64(exposedB.deviceEd25519Public),
					deviceX25519Pub: bytesToBase64(exposedB.deviceX25519Public),
					deviceLabel: "B",
					addedAt: 1,
					addedBy: bytesToBase64(exposedA.publicKey),
				},
				exposedA.secretKey,
			);
			devicesStore.add(record);
			expect(devicesStore.isRevoked(exposedB.deviceEd25519Public)).toBe(false);
			devicesStore.revoke(record.deviceEd25519Pub, 2);
			expect(devicesStore.isRevoked(exposedB.deviceEd25519Public)).toBe(true);

			// Now exercise the pipeline: A receives a frame purportedly from
			// B; the verifier MUST drop with `Revoked` before sig-verify.
			// We construct a minimal valid Update frame.
			const dekStore = await sessionB.entityDekStore();
			const dekId = dekStore.nextDekId();
			const db = await sessionB.dataStores.open("entities");
			const { EntitiesRepository } = await import("../storage/entities-repo");
			const repo = new EntitiesRepository(db);
			repo.create({
				id: ENTITY_ID,
				type: "brainstorm/Note/v1",
				properties: { name: "x" },
				createdBy: "test",
				now: Date.now(),
				dekId,
			});
			const handle = dekStore.persist(ENTITY_ID, dekId);
			dekStore.close(handle.dek);

			let verifyCallCount = 0;
			const senderDevicePub = exposedB.deviceEd25519Public; // sender = B
			const ctxA: PipelineContext = {
				dekStore,
				devicePub: senderDevicePub,
				deviceSign: (bytes) => sessionB.signWithDeviceKey(bytes),
				deviceVerify: (sig, bytes, pub) => {
					verifyCallCount++;
					try {
						return ed25519.verify(sig, bytes, pub);
					} catch {
						return false;
					}
				},
				resolveEntity: (id) => (id === ENTITY_ID ? { id: ENTITY_ID, type: "T" } : null),
				relay: {
					send: () => undefined,
					onFrame: () => undefined,
					offFrame: () => undefined,
					close: () => undefined,
				},
				nextSeq: () => 0,
				nowMs: () => 1,
				randomNonce: () => freshNonce(),
				isDeviceRevoked: (sender: Uint8Array) => devicesStore.isRevoked(sender),
			};

			// Build a real frame from B's perspective; we'll use the same
			// dekStore (the entity row is on B's side here for simplicity).
			const frames: Uint8Array[] = [];
			const ctxBSend: PipelineContext = {
				...ctxA,
				relay: {
					send: (f: Uint8Array) => frames.push(f),
					onFrame: () => undefined,
					offFrame: () => undefined,
					close: () => undefined,
				},
				devicePub: senderDevicePub,
				deviceSign: (bytes) => sessionB.signWithDeviceKey(bytes),
				isDeviceRevoked: () => false, // sender doesn't self-block
			};
			await encryptAndEmit(ENTITY_ID, new Uint8Array([1, 2, 3]), ctxBSend);
			expect(frames.length).toBe(1);

			let thrown: Error | null = null;
			try {
				await receiveAndApply(frames[0] as Uint8Array, ctxA, () => undefined);
			} catch (error) {
				thrown = error as Error;
			}
			expect(thrown).not.toBeNull();
			expect(thrown?.name).toBe("Revoked");
			expect(verifyCallCount).toBe(0); // sig-verify never ran.
		} finally {
			sessionA.dispose();
			sessionB.dispose();
		}
	}, 10_000);
});
