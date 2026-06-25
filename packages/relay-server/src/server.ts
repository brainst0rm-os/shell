/**
 * Stage 10.4 — `Bun.serve`-backed blind relay server.
 *
 * One process. One port. Pure-WebSocket transport. The wire protocol is
 * the first-byte-tagged channel: `0x00` = JSON control message
 * (subscribe/unsubscribe), `0x01` = opaque `EncryptedFrame` bytes. The
 * relay never parses past the routing header inside the frame.
 *
 * **Relay-blind invariant.** Zero crypto imports anywhere in the server
 * code path. The 12th structural CI fence at
 * `tools/mcp-server/src/tools/relay-noble-import-check.ts` is extended
 * in 10.4 to also match `packages/relay-server/src/**`, so adding a
 * `@noble/*` / envelope-seal import fails the audit.
 *
 * The server itself is a tiny orchestration shim around `FrameRouter` —
 * the actual decision-making is in `router.ts`, so the server is testable
 * by driving the WebSocket handlers directly.
 */

// relay-blind: this file intentionally has zero crypto/credential imports.
// The CI gate covers the relay-server package; the imports below are
// forbidden and any future addition requires a per-line
// `// relay-blind-exempt` review note.

import { AuditLog, type AuditSink } from "./audit-log";
import { FrameRouter } from "./router";

const CONTROL_CHANNEL_BYTE = 0x00;
const FRAME_CHANNEL_BYTE = 0x01;

export type RelayServerOptions = {
	port: number;
	auditSink?: AuditSink;
	/** Override the connection-id generator for deterministic tests. */
	mintConnId?: () => string;
	now?: () => number;
};

export type SubscribeControl = { op: "subscribe"; entityIds: string[] };
export type UnsubscribeControl = { op: "unsubscribe"; entityIds: string[] };
export type RelayControlMessage = SubscribeControl | UnsubscribeControl;

/**
 * Minimal Bun-ws-shaped interface so the server module is testable
 * without spinning a real socket. The shape is the intersection of
 * `Bun.ServerWebSocket` and `ws.WebSocket` that we actually use.
 */
export interface ServerWebSocketLike {
	send(data: Uint8Array | string): void;
	close(code?: number, reason?: string): void;
	readonly data?: { connId?: string };
}

export type ConnectionHandlers = {
	onOpen(ws: ServerWebSocketLike): string;
	onMessage(ws: ServerWebSocketLike, raw: Uint8Array | string): void;
	onClose(ws: ServerWebSocketLike): void;
};

export type RelayCore = {
	router: FrameRouter;
	audit: AuditLog;
	handlers: ConnectionHandlers;
	/** Set of active connections keyed by connId. Test-visible. */
	connections: Map<string, ServerWebSocketLike>;
};

/**
 * Build the routing + audit + handler core. The HTTP/WS server itself
 * (`Bun.serve(...)`) is built in `bin/relay.ts`; everything testable
 * lives here.
 */
export function createRelayCore(
	opts: { auditSink?: AuditSink; mintConnId?: () => string; now?: () => number } = {},
): RelayCore {
	const audit = new AuditLog({
		...(opts.auditSink ? { sink: opts.auditSink } : {}),
		...(opts.now ? { now: opts.now } : {}),
	});
	const router = new FrameRouter(audit);
	const connections = new Map<string, ServerWebSocketLike>();
	const mintConnId = opts.mintConnId ?? defaultMintConnId();

	function send(toConnId: string, frame: Uint8Array): void {
		const ws = connections.get(toConnId);
		if (!ws) return;
		// Re-wrap with the frame channel byte. The relay's outbound wire
		// always carries the `0x01` discriminator so the recipient client
		// can route the same way it routes any other inbound frame.
		const wire = new Uint8Array(1 + frame.length);
		wire[0] = FRAME_CHANNEL_BYTE;
		wire.set(frame, 1);
		try {
			ws.send(wire);
		} catch {
			// Already-closed sockets can throw on Bun; the router calls
			// us through a try/catch so an individual failure doesn't
			// block fan-out.
		}
	}

	const handlers: ConnectionHandlers = {
		onOpen(ws) {
			const connId = mintConnId();
			(ws as { data?: { connId?: string } }).data = { connId };
			connections.set(connId, ws);
			return connId;
		},
		onMessage(ws, raw) {
			const connId = (ws as { data?: { connId?: string } }).data?.connId;
			if (!connId) return;
			const bytes = normalizeIncoming(raw);
			if (!bytes || bytes.length < 1) return;
			const channel = bytes[0];
			if (channel === FRAME_CHANNEL_BYTE) {
				const frame = bytes.subarray(1);
				router.route(connId, frame, send);
				return;
			}
			if (channel === CONTROL_CHANNEL_BYTE) {
				const message = parseControl(bytes.subarray(1));
				if (!message) return;
				if (message.op === "subscribe") {
					for (const entityId of message.entityIds) router.subscribe(connId, entityId);
				} else {
					for (const entityId of message.entityIds) router.unsubscribe(connId, entityId);
				}
				return;
			}
			// Unknown channel byte — drop silently. Stays available for
			// forward-compat (a future control sub-channel).
		},
		onClose(ws) {
			const connId = (ws as { data?: { connId?: string } }).data?.connId;
			if (!connId) return;
			router.dropConnection(connId);
			connections.delete(connId);
		},
	};

	return { router, audit, handlers, connections };
}

function parseControl(body: Uint8Array): RelayControlMessage | null {
	try {
		const json = new TextDecoder().decode(body);
		const parsed = JSON.parse(json) as unknown;
		if (!parsed || typeof parsed !== "object") return null;
		const v = parsed as { op?: unknown; entityIds?: unknown };
		if (v.op !== "subscribe" && v.op !== "unsubscribe") return null;
		if (!Array.isArray(v.entityIds)) return null;
		const entityIds = v.entityIds.filter((e): e is string => typeof e === "string" && e.length > 0);
		return { op: v.op, entityIds };
	} catch {
		return null;
	}
}

function normalizeIncoming(raw: Uint8Array | string): Uint8Array | null {
	if (raw instanceof Uint8Array) return raw;
	if (typeof raw === "string") {
		// A plain string body has no channel prefix; we cannot route it.
		// Drop — the wire protocol is binary-only.
		return null;
	}
	return null;
}

function defaultMintConnId(): () => string {
	let counter = 0;
	return () => {
		counter += 1;
		const random = Math.random().toString(36).slice(2, 8);
		return `c${counter}_${random}`;
	};
}
