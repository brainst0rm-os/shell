#!/usr/bin/env bun
/**
 * Stage 10.4 — relay-server CLI entry.
 *
 * Usage:
 *   bun --bun run bin/relay.ts --port 7780 [--audit-log-path /path/to/log.jsonl]
 *
 * The CLI is intentionally minimal. Operational hardening (auth tokens,
 * TLS, rate limits, log rotation) is post-v1 and lands when 10.5+ wires
 * the user-facing pairing UX.
 */

import { appendFile } from "node:fs/promises";
import { createRelayCore } from "../src/server";

type Args = {
	port: number;
	auditLogPath: string | null;
};

function parseArgs(argv: readonly string[]): Args {
	let port = 7780;
	let auditLogPath: string | null = null;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--port") {
			const next = argv[i + 1];
			if (!next) throw new Error("--port requires a value");
			const parsed = Number(next);
			if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
				throw new Error(`--port: invalid port ${next}`);
			}
			port = parsed;
			i += 1;
		} else if (arg === "--audit-log-path") {
			const next = argv[i + 1];
			if (!next) throw new Error("--audit-log-path requires a value");
			auditLogPath = next;
			i += 1;
		}
	}
	return { port, auditLogPath };
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const auditLogPath = args.auditLogPath;
	const core = createRelayCore({
		...(auditLogPath
			? {
					auditSink: (line: string) => {
						void appendFile(auditLogPath, `${line}\n`, "utf8").catch((err) => {
							console.warn(`[relay] audit-log append failed: ${(err as Error).message}`);
						});
					},
				}
			: {}),
	});

	// 10.9d step-2 instrumentation: BRAINSTORM_SOAK_DEBUG=1 logs every
	// subscribe/unsubscribe + per-frame route decision so the soak harness
	// (or a manual two-shell repro) reveals exactly where the SealedIdentity
	// hand-off dies. Off by default; cheap when on (one console.log per
	// control message + per frame).
	const debugLog = process.env.BRAINSTORM_SOAK_DEBUG === "1";

	// Bun.serve is the runtime; we use a runtime-narrowed `globalThis.Bun`
	// access so the relay module can be imported in non-Bun environments
	// (Node tests) without throwing at import time.
	const BunRuntime = (globalThis as { Bun?: { serve: (opts: unknown) => unknown } }).Bun;
	if (!BunRuntime) {
		throw new Error("relay-server: bin/relay.ts must run under Bun (globalThis.Bun missing)");
	}
	BunRuntime.serve({
		port: args.port,
		websocket: {
			open(ws: { data?: { connId?: string }; send(d: Uint8Array): void; close(): void }) {
				const connId = core.handlers.onOpen(ws);
				console.info(`[relay] open conn=${connId}`);
				if (debugLog) {
					console.info(`[relay/debug] connId set on ws.data: ${JSON.stringify(ws.data ?? null)}`);
				}
			},
			message(
				ws: { data?: { connId?: string }; send(d: Uint8Array): void; close(): void },
				message: Uint8Array | string,
			) {
				if (debugLog) {
					const connId = ws.data?.connId ?? "?";
					const bytes = message instanceof Uint8Array ? message : null;
					const channelByte = bytes && bytes.length > 0 ? bytes[0] : "?";
					const len = bytes?.length ?? message.toString().length;
					console.info(`[relay/debug] message conn=${connId} ch=${channelByte} bytes=${len}`);
				}
				core.handlers.onMessage(ws, message);
				if (debugLog) {
					const connId = ws.data?.connId ?? "?";
					const subs = core.router.connectionEntities(connId);
					console.info(`[relay/debug] post-message conn=${connId} subs=[${subs.join(",")}]`);
				}
			},
			close(ws: { data?: { connId?: string }; send(d: Uint8Array): void; close(): void }) {
				const connId = ws.data?.connId ?? "?";
				core.handlers.onClose(ws);
				console.info(`[relay] close conn=${connId}`);
			},
		},
		fetch(req: { headers: Headers }, server: { upgrade: (req: unknown) => boolean }) {
			if (server.upgrade(req)) return undefined;
			return new Response("brainstorm relay v1", { status: 200 });
		},
	});
	console.info(`[relay] listening on :${args.port}`);
}

void main().catch((error) => {
	console.error(`[relay] fatal: ${(error as Error).message}`);
	process.exit(1);
});
