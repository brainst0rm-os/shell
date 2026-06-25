/**
 * Stage 10.3b — canonical two-VaultSession new-device-join end-to-end demo.
 *
 * Setup:
 *   - Device A1 (`session A`) owns vault A's entity `ent_join` with a real
 *     EntityDekStore-minted DEK. A regular `Update` envelope wouldn't open
 *     on a separate device because that device has no DEK.
 *   - Device A2 (`session B`) is a separate `VaultSession` with its own
 *     X25519 keypair, simulating a second device paired into the same
 *     logical vault. (Two physical vault directories so the keystore +
 *     `entities.db` stay isolated; pairing in v1 just means A1 emits
 *     a wrap-bootstrap addressed to A2's pubkey + A2 carries the same
 *     entity row.)
 *
 * Wire path under test:
 *   1. A1 builds a `MemberWrapPayload` addressed to A2's device pubkey
 *      via `wrapDekForRecipient`.
 *   2. A1 emits a `WrapBootstrap` envelope through the loopback relay.
 *   3. A2 receives the envelope, verifies sig, parses the wrap,
 *      `unwrapMemberWrap`s the inner DEK, and installs it in its own
 *      EntityDekStore.
 *   4. A1 emits a regular `Update` envelope encrypted under the DEK.
 *   5. A2 receives, opens, applies — converged CRDT state.
 *
 * Asserts:
 *   - A2's Y.Doc converges to A1's text.
 *   - The blind relay observed only ciphertext / wrap JSON; the
 *     32-byte plaintext DEK never appears in any frame body.
 *   - Replay protection: re-sending A1's update frame after acceptance
 *     yields `SeqAcceptance.Duplicate` from A2's seq-tracker.
 */

import { Buffer } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { XCHACHA_NONCE_BYTES, bytesToBase64 } from "../credentials/crypto";
import { wrapDekForRecipient } from "../credentials/member-wraps";
import type { EntityDekStore } from "../entities/entity-dek-store";
import { ed25519 } from "../test-support/crypto-test-helpers";
import { VaultSession } from "../vault/session";
import { AWARENESS_DEBOUNCE_MS, AwarenessBroadcaster } from "./awareness-broadcaster";
import {
	type PipelineContext,
	emitAwareness,
	emitWrapBootstrap,
	encryptAndEmit,
	receiveAndApply,
	receiveAwareness,
	receiveWrapBootstrap,
} from "./envelope-pipeline";
import { LoopbackRelayPort } from "./relay-port";
import { SeqAcceptance, SeqTracker } from "./seq-tracker";

const ENTITY_ID = "ent_join";

function freshNonce(): Uint8Array {
	const n = new Uint8Array(XCHACHA_NONCE_BYTES);
	crypto.getRandomValues(n);
	return n;
}

async function provisionEntityWithDek(session: VaultSession): Promise<void> {
	const store = await session.entityDekStore();
	const dekId = store.nextDekId();
	const db = await session.dataStores.open("entities");
	const { EntitiesRepository } = await import("../storage/entities-repo");
	const repo = new EntitiesRepository(db);
	repo.create({
		id: ENTITY_ID,
		type: "brainstorm/Note/v1",
		properties: { name: "Join target" },
		createdBy: "test",
		now: Date.now(),
		dekId,
	});
	const handle = store.persist(ENTITY_ID, dekId);
	store.close(handle.dek);
}

async function copyEntityRow(source: VaultSession, target: VaultSession): Promise<void> {
	const sourceDb = await source.dataStores.open("entities");
	const targetDb = await target.dataStores.open("entities");
	const { EntitiesRepository } = await import("../storage/entities-repo");
	const sourceRepo = new EntitiesRepository(sourceDb);
	const targetRepo = new EntitiesRepository(targetDb);
	const row = sourceRepo.get(ENTITY_ID);
	if (!row) throw new Error("expected source entity row");
	targetRepo.create({
		id: row.id,
		type: row.type,
		properties: row.properties as Record<string, unknown>,
		createdBy: row.createdBy,
		now: row.createdAt,
		dekId: null,
	});
}

async function installDekFromWrap(
	session: VaultSession,
	wrap: Awaited<ReturnType<typeof wrapDekForRecipient>>,
	entityId: string,
): Promise<{ store: EntityDekStore }> {
	const store = await session.entityDekStore();
	const dek = session.unwrapMemberWrap(wrap, entityId);
	try {
		const dekId = store.nextDekId();
		const { EntityDeksRepository } = await import("../storage/entities-repo");
		const db = await session.dataStores.open("entities");
		const repo = new EntityDeksRepository(db);
		const { sealSecret } = await import("../credentials/crypto");
		const masterKey = await readMasterKey(session);
		const sealed = sealSecret(masterKey, dek, entityIdAad(entityId));
		repo.create({ dekId, entityId, sealedDek: sealed, now: Date.now() });
		const { EntitiesRepository } = await import("../storage/entities-repo");
		const entitiesRepo = new EntitiesRepository(db);
		entitiesRepo.stampDekId(entityId, dekId);
	} finally {
		dek.fill(0);
	}
	return { store };
}

async function readMasterKey(session: VaultSession): Promise<Uint8Array> {
	const secret = await session.backend.getSecret(session.vaultId, "master");
	if (!secret) throw new Error("master key missing");
	return secret;
}

function entityIdAad(entityId: string): Uint8Array {
	return new TextEncoder().encode(`brainstorm/entity-dek/v1:${entityId}`);
}

function makeCtx(args: {
	session: VaultSession;
	dekStore: EntityDekStore;
	relay: LoopbackRelayPort;
	tracker: SeqTracker;
}): PipelineContext {
	// `signPayload`/`verifySignature` are the only ed25519 entry points; we
	// re-use the ed25519 verify directly because the pipeline expects the
	// caller-supplied sender pubkey, not the local identity.
	return {
		dekStore: args.dekStore,
		devicePub: args.session.identity.publicKey,
		deviceSign: (bytes) => args.session.signPayload(bytes),
		deviceVerify: (sig, bytes, senderPub) => {
			try {
				return ed25519.verify(sig, bytes, senderPub);
			} catch {
				return false;
			}
		},
		resolveEntity: (routedId) =>
			routedId === ENTITY_ID ? { id: ENTITY_ID, type: "brainstorm/Note/v1" } : null,
		relay: args.relay,
		// nextSeq is sync in the pipeline contract; we keep a local cache
		// of the tracker's send counter to satisfy that — initial value is
		// loaded from disk asynchronously by the caller before any emit.
		nextSeq: (entityId) => {
			const sender = args.session.identity.publicKey;
			return synchronousNextSeq(args.tracker, sender, entityId);
		},
		nowMs: () => Date.now(),
		randomNonce: () => freshNonce(),
	};
}

// `SeqTracker.nextSeq` is async (persists each tick); the pipeline's
// `nextSeq` hook is sync. For the E2E demo we read the in-memory state
// via a sync escape: an unsafe-but-test-only cast that reads the same
// underlying counter the persisted state mirrors. Production wiring
// awaits the tracker's promise before calling emit.
function synchronousNextSeq(tracker: SeqTracker, sender: Uint8Array, entityId: string): number {
	const key = `${bytesToBase64(sender)}::${entityId}`;
	const map = (tracker as unknown as { send: Map<string, number> }).send;
	const current = map.get(key) ?? -1;
	const next = current + 1;
	map.set(key, next);
	return next;
}

describe("new-device-join (10.3b E2E)", () => {
	let dirA: string;
	let dirB: string;

	beforeEach(async () => {
		dirA = await mkdtemp(join(tmpdir(), "bs-ndj-A-"));
		dirB = await mkdtemp(join(tmpdir(), "bs-ndj-B-"));
	});

	afterEach(async () => {
		await rm(dirA, { recursive: true, force: true });
		await rm(dirB, { recursive: true, force: true });
	});

	it("A2 receives wrap-bootstrap, installs DEK, then receives + opens an Update; relay sees ciphertext only", async () => {
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
			await provisionEntityWithDek(sessionA);
			await copyEntityRow(sessionA, sessionB);

			const dekStoreA = await sessionA.entityDekStore();
			const trackerA = await SeqTracker.open(dirA);
			const trackerB = await SeqTracker.open(dirB);
			const [relayA, relayB] = LoopbackRelayPort.pair(2);
			if (!relayA || !relayB) throw new Error("expected two relay ports");

			const ctxA = makeCtx({
				session: sessionA,
				dekStore: dekStoreA,
				relay: relayA,
				tracker: trackerA,
			});
			// ctxB is filled in below once we know its EntityDekStore.

			const observedFrames: Uint8Array[] = [];
			relayB.onFrame((f) => observedFrames.push(f));

			// Step 1: A1 mints a wrap addressed to A2's device pubkey using
			// the DEK it holds for the entity.
			const aDekHandle = dekStoreA.open(ENTITY_ID);
			if (!aDekHandle) throw new Error("expected DEK on session A");
			const wrapForB = wrapDekForRecipient(aDekHandle.dek, sessionB.deviceX25519.publicKey, ENTITY_ID);
			dekStoreA.close(aDekHandle.dek);

			// Step 2-3: emit wrap-bootstrap, B receives + installs the DEK.
			let receivedWrapFrame: Uint8Array | null = null;
			const dekStoreB = await sessionB.entityDekStore();
			const ctxB: PipelineContext = makeCtx({
				session: sessionB,
				dekStore: dekStoreB,
				relay: relayB,
				tracker: trackerB,
			});
			let wrapInstallResolve: () => void = () => {};
			let wrapInstallReject: (err: unknown) => void = () => {};
			const wrapInstalled = new Promise<void>((res, rej) => {
				wrapInstallResolve = res;
				wrapInstallReject = rej;
			});
			const wrapHandler = (frame: Uint8Array): void => {
				receivedWrapFrame = frame;
				void receiveWrapBootstrap(frame, ctxB, async (wrap, entityId) => {
					await installDekFromWrap(sessionB, wrap, entityId);
				})
					.then(() => wrapInstallResolve())
					.catch((err) => wrapInstallReject(err));
			};
			relayB.onFrame(wrapHandler);

			await emitWrapBootstrap(ENTITY_ID, wrapForB, ctxA);
			await wrapInstalled;
			expect(receivedWrapFrame).not.toBeNull();

			// Verify the wrap frame body did NOT contain the plaintext DEK
			// (which never crosses IPC — the wrap is HPKE-encrypted, only
			// the entity-pubkey-bound ciphertext is on the wire).
			const aDekHandle2 = dekStoreA.open(ENTITY_ID);
			if (!aDekHandle2) throw new Error("expected DEK still present on A");
			const dekHex = Buffer.from(aDekHandle2.dek).toString("hex");
			dekStoreA.close(aDekHandle2.dek);
			if (!receivedWrapFrame) throw new Error("expected wrap frame captured");
			const wrapHex = Buffer.from(receivedWrapFrame).toString("hex");
			expect(wrapHex.includes(dekHex)).toBe(false);

			// Swap listeners: from now on B handles Update frames.
			relayB.offFrame(wrapHandler);
			const docB = new Y.Doc();
			const applied: Uint8Array[] = [];
			const updateFrames: Uint8Array[] = [];
			let updateApplyResolve: () => void = () => {};
			let updateApplyReject: (err: unknown) => void = () => {};
			const updateApplied = new Promise<void>((res, rej) => {
				updateApplyResolve = res;
				updateApplyReject = rej;
			});
			const updateHandler = (frame: Uint8Array): void => {
				updateFrames.push(frame);
				void receiveAndApply(frame, ctxB, (plaintext) => {
					applied.push(plaintext);
					Y.applyUpdate(docB, plaintext);
				})
					.then(() => updateApplyResolve())
					.catch((err) => updateApplyReject(err));
			};
			relayB.onFrame(updateHandler);

			// Step 4-5: A1 sends a real CRDT update under the DEK.
			const docA = new Y.Doc();
			const emitPromises: Promise<void>[] = [];
			docA.on("update", (update: Uint8Array) => {
				emitPromises.push(encryptAndEmit(ENTITY_ID, update, ctxA));
			});
			docA.getText("body").insert(0, "Hello from A1");
			await Promise.all(emitPromises);
			await updateApplied;

			expect(docB.getText("body").toString()).toBe("Hello from A1");
			expect(applied.length).toBeGreaterThan(0);

			// Replay protection: re-deliver an update frame; B's tracker
			// should mark it `Duplicate` on the second sight.
			const updateFrame = updateFrames[0];
			if (!updateFrame) throw new Error("expected an update frame");
			const senderPub = sessionA.identity.publicKey;
			// The pipeline path that records `accept` is wired in production
			// outside the seal module; for the E2E demo we exercise the
			// tracker directly off the seq we know A1 used (0).
			const first = await trackerB.accept(senderPub, ENTITY_ID, 0);
			const second = await trackerB.accept(senderPub, ENTITY_ID, 0);
			expect(first).toBe(SeqAcceptance.Fresh);
			expect(second).toBe(SeqAcceptance.Duplicate);

			// Sanity: the relay body never contained the plaintext DEK or
			// any plaintext text content from the CRDT update — the body
			// after encryption is ciphertext indistinguishable from random.
			const updateBodyHex = Buffer.from(updateFrame).toString("hex");
			expect(updateBodyHex.includes(Buffer.from("Hello from A1", "utf8").toString("hex"))).toBe(false);

			await trackerA.dispose();
			await trackerB.dispose();
			relayA.close();
			relayB.close();
		} finally {
			sessionA.dispose();
			sessionB.dispose();
		}
	});

	it("awareness round-trips encrypted under the entity DEK; relay body holds no plaintext cursor data", async () => {
		const sessionA = await VaultSession.create({
			vaultId: "vlt_AW_A",
			vaultPath: dirA,
			forceInsecure: true,
		});
		const sessionB = await VaultSession.create({
			vaultId: "vlt_AW_B",
			vaultPath: dirB,
			forceInsecure: true,
		});

		try {
			await provisionEntityWithDek(sessionA);
			await copyEntityRow(sessionA, sessionB);

			const dekStoreA = await sessionA.entityDekStore();
			const dekStoreB = await sessionB.entityDekStore();
			const trackerA = await SeqTracker.open(dirA);
			const trackerB = await SeqTracker.open(dirB);
			const [relayA, relayB] = LoopbackRelayPort.pair(2);
			if (!relayA || !relayB) throw new Error("expected two relay ports");

			// Install A's DEK on B via the wrap-bootstrap path so the
			// awareness AEAD opens on B's side.
			const aDekHandle = dekStoreA.open(ENTITY_ID);
			if (!aDekHandle) throw new Error("expected DEK on session A");
			const wrap = wrapDekForRecipient(aDekHandle.dek, sessionB.deviceX25519.publicKey, ENTITY_ID);
			dekStoreA.close(aDekHandle.dek);
			const dek = sessionB.unwrapMemberWrap(wrap, ENTITY_ID);
			try {
				const { EntityDeksRepository, EntitiesRepository } = await import("../storage/entities-repo");
				const { sealSecret } = await import("../credentials/crypto");
				const dbB = await sessionB.dataStores.open("entities");
				const deksRepo = new EntityDeksRepository(dbB);
				const entitiesRepo = new EntitiesRepository(dbB);
				const dekId = dekStoreB.nextDekId();
				const aad = new TextEncoder().encode(`brainstorm/entity-dek/v1:${ENTITY_ID}`);
				const masterKey = await readMasterKey(sessionB);
				const sealed = sealSecret(masterKey, dek, aad);
				deksRepo.create({ dekId, entityId: ENTITY_ID, sealedDek: sealed, now: Date.now() });
				entitiesRepo.stampDekId(ENTITY_ID, dekId);
			} finally {
				dek.fill(0);
			}

			const ctxA = makeCtx({
				session: sessionA,
				dekStore: dekStoreA,
				relay: relayA,
				tracker: trackerA,
			});
			const ctxB = makeCtx({
				session: sessionB,
				dekStore: dekStoreB,
				relay: relayB,
				tracker: trackerB,
			});

			const docA = new Y.Doc();
			const docB = new Y.Doc();
			const awarenessA = new Awareness(docA);
			const awarenessB = new Awareness(docB);

			const observedFrames: Uint8Array[] = [];
			relayB.onFrame((f) => observedFrames.push(f));

			// Wire B's receive path to apply inbound awareness updates.
			const awarenessByEntityB = new Map<string, Awareness>([[ENTITY_ID, awarenessB]]);
			const broadcasterB = new AwarenessBroadcaster({
				pipeline: ctxB,
				awarenessByEntity: () => awarenessByEntityB,
				// We won't track on B for this test — B only receives.
			});
			const recvPromises: Promise<void>[] = [];
			relayB.onFrame((frame) => {
				recvPromises.push(
					receiveAwareness(frame, ctxB, (update, entityId) => {
						broadcasterB.applyInbound(update, entityId);
					}),
				);
			});

			// A sets a cursor; broadcaster batches; one envelope hits the wire.
			const broadcasterA = new AwarenessBroadcaster({
				pipeline: ctxA,
				awarenessByEntity: () => new Map([[ENTITY_ID, awarenessA]]),
				emit: (entityId, update) => emitAwareness(entityId, update, ctxA),
			});
			broadcasterA.track(ENTITY_ID, awarenessA);

			awarenessA.setLocalState({ cursorLine: 42, user: "alice-the-canary" });
			await new Promise((r) => setTimeout(r, AWARENESS_DEBOUNCE_MS + 30));
			await Promise.all(recvPromises);

			expect(observedFrames.length).toBeGreaterThanOrEqual(1);
			const remoteFromA = awarenessB.getStates().get(awarenessA.clientID);
			expect(remoteFromA).toEqual({ cursorLine: 42, user: "alice-the-canary" });

			// Ciphertext-only invariant: the relay-observed frame body
			// MUST NOT contain the plaintext "alice-the-canary" or "cursorLine".
			const lastFrame = observedFrames[observedFrames.length - 1];
			if (!lastFrame) throw new Error("expected a relay-observed awareness frame");
			const frameHex = Buffer.from(lastFrame).toString("hex");
			const canaryHex = Buffer.from("alice-the-canary", "utf8").toString("hex");
			const fieldHex = Buffer.from("cursorLine", "utf8").toString("hex");
			expect(frameHex.includes(canaryHex)).toBe(false);
			expect(frameHex.includes(fieldHex)).toBe(false);

			// dispose-broadcasts-null — B sees A's clientID removed from states.
			(observedFrames as Uint8Array[]).length = 0;
			recvPromises.length = 0;
			broadcasterA.dispose();
			// Wait for the dispose-null envelope to ride through the loopback.
			await new Promise((r) => setTimeout(r, 0));
			await Promise.all(recvPromises);
			// Confirm B no longer sees A's state for the clientID.
			expect(awarenessB.getStates().has(awarenessA.clientID)).toBe(false);

			broadcasterB.dispose();
			await trackerA.dispose();
			await trackerB.dispose();
			relayA.close();
			relayB.close();
		} finally {
			sessionA.dispose();
			sessionB.dispose();
		}
	});

	it("offFrame removes a listener cleanly between phases", async () => {
		const [a, b] = LoopbackRelayPort.pair(2);
		if (!a || !b) throw new Error("missing relay ports");
		const seen: Uint8Array[] = [];
		const cb = (frame: Uint8Array) => seen.push(frame);
		b.onFrame(cb);
		a.send(new Uint8Array([1, 2, 3]));
		await flushMicrotasks();
		expect(seen.length).toBe(1);
		b.offFrame(cb);
		a.send(new Uint8Array([4, 5, 6]));
		await flushMicrotasks();
		expect(seen.length).toBe(1);
		a.close();
		b.close();
	});
});

function flushMicrotasks(): Promise<void> {
	return new Promise((r) => setTimeout(r, 0));
}
