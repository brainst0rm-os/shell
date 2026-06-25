/**
 * Stage 10.4 — relay-server routing table.
 *
 * Pure data-flow class. Holds the `(entityId → Set<connId>)` subscription
 * table; on `route(connId, frame)` peeks the routing header, fans out the
 * untouched frame bytes to every other subscriber for that entity, and
 * appends one audit-log entry per delivery.
 *
 * **No echo.** A subscriber that's also the sender does NOT receive its
 * own frame back. The 10.0 spike's spec is `entityId → set of subscribed
 * device labels`; we use per-connection ids so a single device with two
 * sockets (rare but possible) gets fan-out across both.
 *
 * **Malformed header tolerance.** A frame whose header fails strict-
 * shape validation is dropped + counted; we do NOT close the offending
 * connection (a malformed-frame-as-DoS would be a worse outcome — the
 * recipient is the last line of defense against bad actors per the 10.0
 * review).
 */

// relay-blind: this file intentionally has zero crypto/credential imports.
// The CI gate covers the relay-server package; the imports below are
// forbidden and any future addition requires a per-line
// `// relay-blind-exempt` review note.

import type { AuditLog } from "./audit-log";
import { type RoutingHeader, peekRoutingHeader } from "./wire";

export type RouteResult = {
	delivered: number;
	dropped: 0 | 1;
	header: RoutingHeader | null;
};

export class FrameRouter {
	readonly #audit: AuditLog;
	readonly #subscriptions = new Map<string, Set<string>>();
	readonly #connectionsByEntity = new Map<string, Set<string>>();
	readonly #entitiesByConnection = new Map<string, Set<string>>();
	#malformedDropped = 0;

	constructor(audit: AuditLog) {
		this.#audit = audit;
	}

	subscribe(connId: string, entityId: string): void {
		let set = this.#connectionsByEntity.get(entityId);
		if (!set) {
			set = new Set<string>();
			this.#connectionsByEntity.set(entityId, set);
		}
		set.add(connId);
		let entitySet = this.#entitiesByConnection.get(connId);
		if (!entitySet) {
			entitySet = new Set<string>();
			this.#entitiesByConnection.set(connId, entitySet);
		}
		entitySet.add(entityId);
	}

	unsubscribe(connId: string, entityId: string): void {
		const set = this.#connectionsByEntity.get(entityId);
		if (set) {
			set.delete(connId);
			if (set.size === 0) this.#connectionsByEntity.delete(entityId);
		}
		const entitySet = this.#entitiesByConnection.get(connId);
		if (entitySet) {
			entitySet.delete(entityId);
			if (entitySet.size === 0) this.#entitiesByConnection.delete(connId);
		}
	}

	dropConnection(connId: string): void {
		const entities = this.#entitiesByConnection.get(connId);
		if (!entities) return;
		for (const entityId of entities) {
			const set = this.#connectionsByEntity.get(entityId);
			if (set) {
				set.delete(connId);
				if (set.size === 0) this.#connectionsByEntity.delete(entityId);
			}
		}
		this.#entitiesByConnection.delete(connId);
	}

	/**
	 * Subscribers for `entityId` excluding `excludeConnId` (the sender).
	 * Returns a fresh array — the caller may mutate the set during fan-out.
	 */
	subscribersFor(entityId: string, excludeConnId: string): string[] {
		const set = this.#connectionsByEntity.get(entityId);
		if (!set) return [];
		const out: string[] = [];
		for (const id of set) {
			if (id !== excludeConnId) out.push(id);
		}
		return out;
	}

	/**
	 * Peek the routing header, fan-out the (untouched) frame bytes to
	 * every OTHER subscriber, and append one audit entry per delivery.
	 *
	 * The caller is responsible for the actual socket-write — the router
	 * is pure logic. We return the recipient list so the server-loop
	 * stays a thin wrapper around the routing decision.
	 */
	route(
		fromConnId: string,
		frame: Uint8Array,
		send: (toConnId: string, frame: Uint8Array) => void,
	): RouteResult {
		let header: RoutingHeader;
		try {
			const peeked = peekRoutingHeader(frame);
			header = peeked.header;
		} catch {
			this.#malformedDropped += 1;
			return { delivered: 0, dropped: 1, header: null };
		}
		// Collab-C5 — fan out by the optional `route` (a recipient inbox channel)
		// when present, else the entity channel. The audit still records the real
		// `entityId`; `route` is an opaque routing label to the blind relay.
		const routingKey = header.route ?? header.entityId;
		const recipients = this.subscribersFor(routingKey, fromConnId);
		let delivered = 0;
		for (const toConnId of recipients) {
			try {
				send(toConnId, frame);
				this.#audit.record({
					fromConnId,
					toConnId,
					entityId: header.entityId,
					kind: header.kind,
					bytes: frame.length,
				});
				delivered += 1;
			} catch {
				// A failed write must not block fan-out to siblings.
			}
		}
		return { delivered, dropped: 0, header };
	}

	malformedDropped(): number {
		return this.#malformedDropped;
	}

	subscriberCount(entityId: string): number {
		return this.#connectionsByEntity.get(entityId)?.size ?? 0;
	}

	connectionEntities(connId: string): readonly string[] {
		const set = this.#entitiesByConnection.get(connId);
		return set ? [...set] : [];
	}
}
