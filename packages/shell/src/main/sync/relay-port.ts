/**
 * Stage 10.3a — relay port + in-process loopback implementation.
 *
 * The relay handles ONE shape: opaque bytes (one encoded `EncryptedFrame`
 * per `send`). It does NOT decode, does NOT verify, does NOT decrypt. The
 * structural CI fence at `tools/mcp-server/src/tools/relay-noble-import-check.ts`
 * pins this invariant — production relay modules MUST NOT import any crypto library,
 * the envelope seal, anything from `../credentials/`, or `node:crypto`.
 *
 * `LoopbackRelayPort` is the in-process fan-out used by tests + the
 * single-vault wire path within one shell instance: every connected port
 * rebroadcasts to every OTHER connected port on `send`. The "other"
 * filter uses per-port identity (a minted internal id), not sender
 * pubkey — the relay is not allowed to read sender at all.
 */

// relay-blind: this file intentionally has zero crypto/credential imports.
// The CI gate at tools/mcp-server/src/tools/relay-noble-import-check.ts
// asserts this; the imports below are forbidden and any future addition
// requires a per-line `// relay-blind-exempt` review note.

export interface RelayPort {
	send(frame: Uint8Array): void;
	onFrame(cb: (frame: Uint8Array) => void): void;
	offFrame(cb: (frame: Uint8Array) => void): void;
	close(): void;
}

/**
 * Stage 10.14 — one entry of a durable node's account catalog: an entity the
 * account has access to, joined with the latest snapshot version the node
 * holds. The restore consumer enumerates these to drive a cold-device fetch.
 * Plaintext routing metadata only (the node records it from the wire header);
 * carries no entity content. Mirrors `brainstorm-sync`'s `catalog-result`.
 */
export type CatalogEntry = { entityId: string; version: number };

/**
 * The swap-stable relay surface consumers bind against (satisfied by
 * `ActiveRelayOrchestrator`): `currentPort()` for the live send target,
 * `onFrame`/`offFrame` for swap-surviving frame listeners, and the
 * optional routing-key `subscribe`/`unsubscribe`. Both the collab dev
 * bridge (`CollabRelayLike`) and the always-on live-sync engine
 * (`10.12`) consume exactly this; defined here so neither has to import
 * the other. Loopback ports satisfy it too (the optional `subscribe`
 * pair is absent — loopback fans to every peer).
 */
export interface RelaySurface {
	currentPort(): RelayPort;
	onFrame(cb: (frame: Uint8Array) => void): void;
	offFrame(cb: (frame: Uint8Array) => void): void;
	subscribe?(routingKey: string): void;
	unsubscribe?(routingKey: string): void;
	/** Stage 10.14 — request the durable node's catalog for `account` (the
	 *  device's wire `sender`, base64url). Resolves with the account's entity
	 *  ids + latest snapshot versions; rejects on timeout or a non-WebSocket
	 *  transport (loopback has no server to answer). Absent ⇒ no durable node. */
	requestCatalog?(account: string): Promise<CatalogEntry[]>;
}

type LoopbackBus = {
	ports: Set<InternalPort>;
};

type InternalPort = {
	id: number;
	listeners: Set<(frame: Uint8Array) => void>;
	closed: boolean;
};

let nextPortId = 1;

/**
 * In-process loopback relay. `LoopbackRelayPort.pair()` returns N ports
 * that share one bus; every `send` on any port rebroadcasts to every
 * other port's subscribers. The relay has no per-port state besides the
 * port set — no entity index, no sender pubkey, no nonces.
 */
export class LoopbackRelayPort implements RelayPort {
	readonly #bus: LoopbackBus;
	readonly #self: InternalPort;

	private constructor(bus: LoopbackBus, self: InternalPort) {
		this.#bus = bus;
		this.#self = self;
	}

	static pair(count = 2): LoopbackRelayPort[] {
		const bus: LoopbackBus = { ports: new Set() };
		const ports: LoopbackRelayPort[] = [];
		for (let i = 0; i < count; i++) {
			const port: InternalPort = {
				id: nextPortId++,
				listeners: new Set(),
				closed: false,
			};
			bus.ports.add(port);
			ports.push(new LoopbackRelayPort(bus, port));
		}
		return ports;
	}

	send(frame: Uint8Array): void {
		if (this.#self.closed) return;
		// Defensive copy so a downstream listener mutating the buffer cannot
		// see writes from the sender's view, and vice versa.
		const copy = new Uint8Array(frame);
		for (const port of this.#bus.ports) {
			if (port === this.#self) continue;
			if (port.closed) continue;
			for (const listener of port.listeners) {
				try {
					listener(copy);
				} catch {
					// A listener throwing must not block fan-out to siblings.
				}
			}
		}
	}

	onFrame(cb: (frame: Uint8Array) => void): void {
		if (this.#self.closed) return;
		this.#self.listeners.add(cb);
	}

	offFrame(cb: (frame: Uint8Array) => void): void {
		this.#self.listeners.delete(cb);
	}

	close(): void {
		this.#self.closed = true;
		this.#self.listeners.clear();
		this.#bus.ports.delete(this.#self);
	}
}
