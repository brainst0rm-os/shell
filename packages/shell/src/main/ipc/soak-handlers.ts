/**
 * Stage 10.9a — soak-only IPC handlers. Registered ONLY when both
 * `!app.isPackaged` (dev) AND `BRAINSTORM_SOAK_DEBUG=1`. Production
 * builds never expose these channels; a normal dev session also doesn't
 * — the env-gate keeps the surface invisible outside a deliberate soak
 * harness run.
 *
 * Channels (privileged, dashboard-only via the preload bridge):
 *   - `dev:soak:get-state-vector` — `Y.encodeStateVector(doc)` of the
 *     entity's persisted Y.Doc as a `Uint8Array`. Convergence proof.
 *   - `dev:soak:get-state-as-update` — `Y.encodeStateAsUpdate(doc)`.
 *     Optional richer probe; not part of the canonical convergence gate.
 *   - `dev:soak:peek-entity-dek` — the entity's DEK bytes. Lets the
 *     post-soak `searchCanaries` step also grep for the raw DEK against
 *     the audit log (defense-in-depth — the audit-log type-fence
 *     already blocks payload-shaped bytes at compile time).
 *   - `dev:soak:set-sync-relay` — calls `setSyncRelayConfig(vaultPath,
 *     ...)` so the harness can wire the relay without going through
 *     Settings UI.
 *   - `dev:soak:append-text` — appends a string into the entity's Y.Doc
 *     text type AND emits the resulting Yjs update through the
 *     encrypted wire-path (`encryptAndEmit`) against the active relay.
 *     The keystroke-cadence generator drives the load through this
 *     entry point so soak fans the encrypted bytes across the relay
 *     audit log the ciphertext-only check then greps.
 *   - `dev:soak:structural-edit` — single structural edit on the
 *     entity's Y.Doc (insert+delete on a Y.Array), emitted through the
 *     same wire-path so the 30-second cadence exercises non-text CRDT
 *     paths.
 *
 * Implementation notes:
 *   - Y.Docs are loaded fresh from disk via `YDocStore.load` on every
 *     call. The shell does not maintain a long-lived in-memory Y.Doc
 *     registry yet (the ydoc-worker holds those); soak is read-only on
 *     the state-vector path and write-only on the append/structural
 *     path — both round-trip through `YDocStore.appendUpdate` so the
 *     persisted state-vector reflects the just-typed delta on the next
 *     `get-state-vector` call.
 *   - Sequence numbers are tracked **in-memory only** for the soak run
 *     (per-process counter map keyed by `(devicePub, entityId)`); the
 *     wire-path's persisted `SeqTracker` is forward work — production
 *     callers will await `tracker.nextSeq()` before calling
 *     `encryptAndEmit`. The harness counter never persists across a
 *     soak run by design (each launch starts at 0).
 *   - No new default-grant capability is added. The handlers are
 *     reachable only via ipcMain directly (privileged dashboard
 *     surface), never through the broker; apps cannot call them.
 *   - Wire-emit is best-effort — if the active relay is null
 *     (vault has no `syncRelay` configured), the local append still
 *     happens. The harness sets the relay URL via `set-sync-relay`
 *     before driving the load so production-shape emit is exercised.
 */

import { ipcMain } from "electron";
import * as Y from "yjs";
import { XCHACHA_NONCE_BYTES, bytesToBase64 } from "../credentials/crypto";
import { verifySignature } from "../credentials/identity";
import type { EntityDekStore } from "../entities/entity-dek-store";
import { installEntityWrap } from "../entities/entity-wraps-installer";
import { EntitiesRepository } from "../storage/entities-repo/entities-repo";
import { getActiveRelay } from "../sync/active-relay";
import { decodeFrame } from "../sync/envelope-codec";
import { type PipelineContext, encryptAndEmit, receiveAndApply } from "../sync/envelope-pipeline";
import type { RelayPort } from "../sync/relay-port";
import { WireKind } from "../sync/routing-header";
import { type VaultSession, getActiveVaultSession } from "../vault/session";
import { setSyncRelayConfig } from "../vault/vault";
import { assertDevEntityId } from "./dev-entity-id";

let installedWireReceiver: ((frame: Uint8Array) => void) | null = null;
let installedWireReceiverEntityId: string | null = null;

/**
 * Per-entity serialization queue. `node:fs/promises.appendFile` is NOT
 * atomic against concurrent calls on the same file — two overlapping
 * `appendUpdate` invocations (e.g. local typing IPC + wire-receiver apply
 * for the same entity) can interleave at the byte level, losing one
 * update. The 10.9b soak observed this as a 1-2 frame trailing divergence
 * in state vectors even after 30 s of post-typing convergence-poll: every
 * frame was routed by the relay, decrypted cleanly, and the wire-receive
 * callback was invoked, but the file write occasionally clobbered a
 * concurrent local-typing write.
 *
 * The fix here is soak-scoped: every appendUpdate that happens through
 * the soak IPC surface (typing + wire-receive) goes through this queue.
 * Production callers route appendUpdate through the ydoc-worker which is
 * a single thread — they don't need this.
 */
const appendUpdateQueues = new Map<string, Promise<unknown>>();

async function serializedAppendUpdate(
	session: VaultSession,
	entityId: string,
	update: Uint8Array,
): Promise<void> {
	const prior = appendUpdateQueues.get(entityId) ?? Promise.resolve();
	const next = prior
		.catch(() => {
			// Swallow prior errors so a failed write doesn't poison the
			// queue for unrelated updates; the writer's own catch reports.
		})
		.then(() => session.ydocStore.appendUpdate(entityId, update));
	appendUpdateQueues.set(entityId, next);
	try {
		await next;
	} finally {
		// If we're the last write in the chain, drop the reference so the
		// map doesn't grow unbounded with done promises.
		if (appendUpdateQueues.get(entityId) === next) {
			appendUpdateQueues.delete(entityId);
		}
	}
}

const SOAK_TEXT_KEY = "soak-text";
const SOAK_LIST_KEY = "soak-list";

const soakSeqCounters = new Map<string, number>();

function freshNonce(): Uint8Array {
	const n = new Uint8Array(XCHACHA_NONCE_BYTES);
	crypto.getRandomValues(n);
	return n;
}

function makeSoakPipelineContext(
	session: VaultSession,
	dekStore: EntityDekStore,
	relay: RelayPort,
): PipelineContext {
	return {
		dekStore,
		devicePub: session.identity.publicKey,
		deviceSign: (bytes) => session.signPayload(bytes),
		deviceVerify: (sig, bytes, senderPub) => verifySignature(senderPub, bytes, sig),
		resolveEntity: (routedId) =>
			routedId.length > 0 ? { id: routedId, type: "brainstorm/Note/v1" } : null,
		relay,
		nextSeq: (entityId) => {
			const key = `${bytesToBase64(session.identity.publicKey)}::${entityId}`;
			const next = (soakSeqCounters.get(key) ?? -1) + 1;
			soakSeqCounters.set(key, next);
			return next;
		},
		nowMs: () => Date.now(),
		randomNonce: () => freshNonce(),
	};
}

export function registerSoakHandlers(): () => void {
	ipcMain.handle("dev:soak:get-state-vector", async (_event, entityId: unknown) => {
		assertEntityId(entityId);
		const session = requireSession();
		const { doc } = await session.ydocStore.load(entityId as string);
		const sv = Y.encodeStateVector(doc);
		doc.destroy();
		return Array.from(sv);
	});

	ipcMain.handle("dev:soak:get-state-as-update", async (_event, entityId: unknown) => {
		assertEntityId(entityId);
		const session = requireSession();
		const { doc } = await session.ydocStore.load(entityId as string);
		const out = Y.encodeStateAsUpdate(doc);
		doc.destroy();
		return Array.from(out);
	});

	/**
	 * 10.9e — install a per-entity DEK + per-device wrap so the soak harness
	 * can fan encrypted update envelopes through the relay. The soak's
	 * `createEntity` uses `ydocStore.load` directly (bypasses the
	 * `EntitiesService.create` path that production wires through),
	 * leaving the entity with no `entity_deks` row. Without one,
	 * `dekStore.open(entityId) → null` and `emitOverWireBestEffort`
	 * silently skips every typed update — no ciphertext on the wire,
	 * state vectors diverge.
	 *
	 * The IPC takes an optional 32-byte DEK. The first shell (source)
	 * calls without bytes — a fresh DEK is minted, the entity row is
	 * stamped with its `dek_id`, the wrap row is sealed under the local
	 * vault master key, the Y.Doc gets one `MemberWrapPayload` HPKE-sealed
	 * to the local device. Returns the DEK bytes so the harness can echo
	 * them to the second shell (target), which calls with `dekBytes` set
	 * — it persists the SAME DEK under its own master key (different
	 * sealed bytes, same plaintext on unwrap) and installs its own device
	 * wrap on its local Y.Doc. After both calls, both shells'
	 * `dekStore.open(entityId)` returns the matching DEK, encryption +
	 * decryption succeed, the wire path round-trips.
	 *
	 * Note: this shortcut bypasses the wrap-bootstrap protocol (10.3b,
	 * `WrapBootstrap` frame kind) that production uses to distribute DEK
	 * wraps to newly-paired devices. The bootstrap protocol is tested
	 * separately at `new-device-join.test.ts`. The soak is about
	 * exercising the wire-encryption + relay-routing + Yjs-merge path
	 * under load, not the wrap-distribution mechanism.
	 */
	ipcMain.handle(
		"dev:soak:install-entity-dek",
		async (_event, entityId: unknown, dekBytesOpt: unknown) => {
			console.info(
				`[dev:soak/debug] install-entity-dek called entityId=${entityId} hasDek=${dekBytesOpt !== null}`,
			);
			assertEntityId(entityId);
			const dekBytes = Array.isArray(dekBytesOpt) ? new Uint8Array(dekBytesOpt as number[]) : null;
			if (dekBytes && dekBytes.length !== 32) {
				throw new Error("dev:soak:install-entity-dek: dek must be a 32-byte number[] when provided");
			}
			const session = requireSession();
			const dekStore = await session.entityDekStore();
			const entitiesDb = await session.dataStores.open("entities");
			const repo = new EntitiesRepository(entitiesDb);
			const idStr = entityId as string;
			// Idempotent: if a DEK already exists, return its bytes (the
			// harness can then verify both sides match).
			const existing = dekStore.open(idStr);
			if (existing) {
				try {
					return { dek: Array.from(existing.dek) };
				} finally {
					dekStore.close(existing.dek);
				}
			}
			const dekId = dekStore.nextDekId();
			const now = Date.now();
			let handle: { dekId: string; dek: Uint8Array } | undefined;
			repo.transaction(() => {
				if (!repo.get(idStr)) {
					repo.create({
						id: idStr,
						type: "brainstorm/SoakTarget/v1",
						properties: {},
						createdBy: bytesToBase64(session.identity.publicKey),
						now,
						dekId,
					});
				}
				handle = dekBytes
					? dekStore.persistWithDek(idStr, dekId, dekBytes)
					: dekStore.persist(idStr, dekId);
			});
			if (!handle) {
				throw new Error("dev:soak:install-entity-dek: dek persistence did not produce a handle");
			}
			const dekHandle = handle;
			try {
				const { doc } = await session.ydocStore.load(idStr);
				try {
					installEntityWrap(doc, dekHandle.dek, session.deviceX25519.publicKey, idStr);
					const update = Y.encodeStateAsUpdate(doc);
					await serializedAppendUpdate(session, idStr, update);
				} finally {
					doc.destroy();
				}
				return { dek: Array.from(dekHandle.dek) };
			} finally {
				dekStore.close(dekHandle.dek);
			}
		},
	);

	/**
	 * 10.9e — install a wire-receive listener on the active relay so the
	 * second shell (target) actually applies incoming encrypted updates to
	 * its local Y.Doc. Production main has no `relay.onFrame` listener wired
	 * in yet (the sync orchestrator integration is post-10.9 work — the
	 * envelope-pipeline `receiveAndApply` is exercised only via test
	 * harnesses today). Without this IPC the soak's send-side runs cleanly
	 * but no remote update ever reaches B's persistence, so state vectors
	 * diverge.
	 *
	 * The listener is per-shell (one global), idempotent (a second call
	 * replaces the prior listener). On every received frame:
	 *   - decode header
	 *   - drop non-Update frames (Pairing / Awareness / WrapBootstrap fan
	 *     into other code paths and out of scope for the soak)
	 *   - `receiveAndApply` opens the DEK, verifies sig, decrypts, hands the
	 *     plaintext Yjs update to the callback
	 *   - callback persists the update via `ydocStore.appendUpdate` so the
	 *     next `Y.encodeStateVector(load(entityId))` reads the merged state
	 */
	ipcMain.handle("dev:soak:install-wire-receiver", async (_event, entityId: unknown) => {
		console.info(`[dev:soak/debug] install-wire-receiver called entityId=${entityId}`);
		assertEntityId(entityId);
		const session = requireSession();
		const orchestrator = getActiveRelay();
		if (!orchestrator) {
			throw new Error("dev:soak:install-wire-receiver: no active relay");
		}
		const dekStore = await session.entityDekStore();
		if (installedWireReceiver) {
			orchestrator.offFrame(installedWireReceiver);
			installedWireReceiver = null;
			// Pair the offFrame with an unsubscribe of the prior entity so
			// the orchestrator's #subscribed Set doesn't accumulate stale
			// entries across reinstalls. Each entityId subscribes/unsubscribes
			// exactly once across the install→reinstall→teardown lifecycle.
			if (installedWireReceiverEntityId !== null) {
				orchestrator.unsubscribe(installedWireReceiverEntityId);
				installedWireReceiverEntityId = null;
			}
		}
		// Subscribe to the entity's relay channel so the relay server fans
		// outbound Update frames from the peer back to us. Without this the
		// relay routes to zero subscribers and the frame is dropped silently
		// (the soak's send-side emit-ok logs fire but the audit log shows
		// only pairing entries; this is exactly the divergence root cause).
		orchestrator.subscribe(entityId as string);
		installedWireReceiverEntityId = entityId as string;
		const subscribedEntityId = entityId as string;
		const listener = (frame: Uint8Array): void => {
			void (async () => {
				try {
					const peeked = decodeFrame(frame);
					if (peeked.header.kind !== WireKind.Update) return;
					// Defense-in-depth: only apply frames addressed to the
					// entity this listener subscribed for. The relay router
					// SHOULD only fan frames matching the routing-header
					// entityId, and `receiveAndApply` requires a valid DEK +
					// signature, but explicit-match here makes the intent
					// obvious + closes any future misroute / cross-entity
					// confusion at this layer too.
					if (peeked.header.entityId !== subscribedEntityId) return;
					const ctx = makeSoakPipelineContext(session, dekStore, orchestrator.currentPort());
					await receiveAndApply(frame, ctx, async (plaintext) => {
						await serializedAppendUpdate(session, peeked.header.entityId, plaintext);
					});
				} catch (error) {
					console.warn(`[dev:soak] wire-receive failed: ${(error as Error).message}`);
				}
			})();
		};
		orchestrator.onFrame(listener);
		installedWireReceiver = listener;
		return { ok: true };
	});

	ipcMain.handle("dev:soak:peek-entity-dek", async (_event, entityId: unknown) => {
		assertEntityId(entityId);
		const session = requireSession();
		const store = await session.entityDekStore();
		const handle = store.open(entityId as string);
		if (!handle) return null;
		try {
			return Array.from(handle.dek);
		} finally {
			store.close(handle.dek);
		}
	});

	ipcMain.handle("dev:soak:set-sync-relay", async (_event, url: unknown) => {
		const session = requireSession();
		if (url === null) {
			await setSyncRelayConfig(session.vaultPath, null);
			return { changed: true };
		}
		if (typeof url !== "string" || url === "") {
			throw new Error("dev:soak:set-sync-relay: url must be a non-empty string or null");
		}
		const result = await setSyncRelayConfig(session.vaultPath, { url, addedAt: Date.now() });
		return { changed: result.changed };
	});

	/**
	 * 10.9d — race-fix gate for the soak harness. After `set-sync-relay`,
	 * the WebSocketRelayPort is in `Connecting`; pairing's `relay.subscribe`
	 * + `port.send(joinFrame)` get queued but only flushed once the WS
	 * reaches `Open`. If the source's WS opens AFTER the target's join-frame
	 * arrives at the relay, the source isn't subscribed yet and the
	 * JoinRequest is dropped, so the target times out awaiting
	 * SealedIdentity. The harness calls this AFTER `set-sync-relay` (per
	 * vault) so the relay-blind connect-race is closed before pairing
	 * starts. The optional `timeoutMs` defaults to 5 s — production callers
	 * never go through this channel, only the soak.
	 */
	ipcMain.handle("dev:soak:wait-relay-open", async (_event, timeoutMs: unknown) => {
		requireSession();
		const orchestrator = getActiveRelay();
		if (!orchestrator) {
			throw new Error("dev:soak:wait-relay-open: no active relay");
		}
		const port = orchestrator.currentPort() as RelayPort & {
			awaitOpen?: (ms?: number) => Promise<void>;
		};
		if (typeof port.awaitOpen !== "function") {
			// Loopback ports are always open synchronously.
			return { open: true };
		}
		const ms = typeof timeoutMs === "number" && Number.isFinite(timeoutMs) ? timeoutMs : 5_000;
		await port.awaitOpen(ms);
		return { open: true };
	});

	ipcMain.handle("dev:soak:append-text", async (_event, entityId: unknown, text: unknown) => {
		assertEntityId(entityId);
		if (typeof text !== "string") {
			throw new Error("dev:soak:append-text: text must be a string");
		}
		const session = requireSession();
		const { doc } = await session.ydocStore.load(entityId as string);
		const before = Y.encodeStateVector(doc);
		doc.getText(SOAK_TEXT_KEY).insert(doc.getText(SOAK_TEXT_KEY).length, text);
		const diff = Y.encodeStateAsUpdate(doc, before);
		doc.destroy();
		await serializedAppendUpdate(session, entityId as string, diff);
		await emitOverWireBestEffort(session, entityId as string, diff);
	});

	ipcMain.handle("dev:soak:structural-edit", async (_event, entityId: unknown) => {
		assertEntityId(entityId);
		const session = requireSession();
		const { doc } = await session.ydocStore.load(entityId as string);
		const before = Y.encodeStateVector(doc);
		const arr = doc.getArray<string>(SOAK_LIST_KEY);
		arr.push([`heading-${arr.length}`]);
		if (arr.length > 16) arr.delete(0, arr.length - 16);
		const diff = Y.encodeStateAsUpdate(doc, before);
		doc.destroy();
		await serializedAppendUpdate(session, entityId as string, diff);
		await emitOverWireBestEffort(session, entityId as string, diff);
	});

	return () => {
		ipcMain.removeHandler("dev:soak:get-state-vector");
		ipcMain.removeHandler("dev:soak:get-state-as-update");
		ipcMain.removeHandler("dev:soak:peek-entity-dek");
		ipcMain.removeHandler("dev:soak:set-sync-relay");
		ipcMain.removeHandler("dev:soak:wait-relay-open");
		ipcMain.removeHandler("dev:soak:install-entity-dek");
		ipcMain.removeHandler("dev:soak:install-wire-receiver");
		ipcMain.removeHandler("dev:soak:append-text");
		ipcMain.removeHandler("dev:soak:structural-edit");
		// Detach the global wire-receiver listener (if installed) so the
		// reload cycle doesn't accumulate handlers across shell restarts.
		// Pairs offFrame with unsubscribe so the orchestrator's #subscribed
		// Set stays clean — same contract as the install path above.
		if (installedWireReceiver) {
			const orchestrator = getActiveRelay();
			if (orchestrator) {
				orchestrator.offFrame(installedWireReceiver);
				if (installedWireReceiverEntityId !== null) {
					orchestrator.unsubscribe(installedWireReceiverEntityId);
				}
			}
			installedWireReceiver = null;
			installedWireReceiverEntityId = null;
		}
	};
}

async function emitOverWireBestEffort(
	session: VaultSession,
	entityId: string,
	update: Uint8Array,
): Promise<void> {
	const debugLog = process.env.BRAINSTORM_SOAK_DEBUG === "1";
	const orchestrator = getActiveRelay();
	if (!orchestrator) {
		if (debugLog) console.info(`[dev:soak/debug] emit-skip no-orchestrator entityId=${entityId}`);
		return;
	}
	const dekStore = await session.entityDekStore();
	const handle = dekStore.open(entityId);
	if (!handle) {
		if (debugLog) console.info(`[dev:soak/debug] emit-skip no-dek entityId=${entityId}`);
		return;
	}
	dekStore.close(handle.dek);
	try {
		const ctx = makeSoakPipelineContext(session, dekStore, orchestrator.currentPort());
		await encryptAndEmit(entityId, update, ctx);
		if (debugLog)
			console.info(`[dev:soak/debug] emit-ok entityId=${entityId} bytes=${update.length}`);
	} catch (error) {
		console.warn(`[dev:soak] wire-emit failed for ${entityId}: ${(error as Error).message}`);
	}
}

/** Validate a soak IPC's entityId argument — delegates to the shared dev-IPC
 *  validator (see `dev-entity-id.ts` for why this is a security boundary: the
 *  id is a filesystem-path component, SQL row key, mutex Map key, and relay
 *  routing id). */
function assertEntityId(value: unknown): void {
	assertDevEntityId(value);
}

function requireSession(): VaultSession {
	const session = getActiveVaultSession();
	if (!session) {
		throw new Error("dev:soak: no active vault session");
	}
	return session;
}
