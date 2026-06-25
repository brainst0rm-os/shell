/**
 * Worker bridge — wraps a utilityProcess (or any duplex-MessagePort-shaped
 * thing) and exposes `send(envelope): Promise<EnvelopeReply>`.
 *
 * Correlation is by the envelope's `msg` id. The bridge owns one pending-reply
 * table; when a reply arrives, the matching promise resolves.
 *
 * Errors:
 *   - If `dispose()` is called with pending requests, they reject with
 *     `Unavailable` (the broker maps this to the SDK's `Unavailable` error
 *     class in Stage 5).
 *   - If a request times out (configurable, default 30s), it rejects.
 *
 * v0 (this stage): plain timeout + correlation. Per-app queue caps and
 * backpressure shedding land in Stage 4 per §Backpressure.
 */

import type { Envelope, EnvelopeReply } from "./envelope";
import { ENVELOPE_PROTOCOL_VERSION, makeErrorReply } from "./envelope";

/** The minimal duplex-port shape this bridge needs. Matches Electron's
 *  `MessagePortMain` and Node's `parentPort` API. Defined here so the bridge
 *  can be tested without spawning a real process. */
export type DuplexPort = {
	postMessage: (message: unknown) => void;
	on: (event: "message", listener: (data: unknown) => void) => void;
	off?: (event: "message", listener: (data: unknown) => void) => void;
	close?: () => void;
};

export type BridgeOptions = {
	defaultTimeoutMs?: number;
};

type Pending = {
	resolve: (reply: EnvelopeReply) => void;
	reject: (error: Error) => void;
	timeoutHandle: ReturnType<typeof setTimeout>;
};

const DEFAULT_TIMEOUT_MS = 30_000;

export class WorkerBridge {
	private readonly port: DuplexPort;
	private readonly defaultTimeoutMs: number;
	private readonly pending = new Map<string, Pending>();
	private readonly listener = (data: unknown) => {
		this.handleIncoming(data);
	};
	private disposed = false;

	constructor(port: DuplexPort, options: BridgeOptions = {}) {
		this.port = port;
		this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.port.on("message", this.listener);
	}

	send(envelope: Envelope, options: { timeoutMs?: number } = {}): Promise<EnvelopeReply> {
		if (this.disposed) {
			return Promise.reject(new Error("WorkerBridge is disposed"));
		}
		const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
		return new Promise<EnvelopeReply>((resolve, reject) => {
			const timeoutHandle = setTimeout(() => {
				const entry = this.pending.get(envelope.msg);
				if (entry) {
					this.pending.delete(envelope.msg);
					entry.reject(new Error(`Worker reply timeout after ${timeoutMs}ms for ${envelope.msg}`));
				}
			}, timeoutMs);
			this.pending.set(envelope.msg, { resolve, reject, timeoutHandle });
			try {
				this.port.postMessage(envelope);
			} catch (error) {
				clearTimeout(timeoutHandle);
				this.pending.delete(envelope.msg);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.port.off?.("message", this.listener);
		this.port.close?.();
		for (const [msg, entry] of this.pending) {
			clearTimeout(entry.timeoutHandle);
			entry.resolve(
				makeErrorReply(msg, {
					kind: "Unavailable",
					message: "WorkerBridge disposed before reply arrived",
				}),
			);
		}
		this.pending.clear();
	}

	private handleIncoming(data: unknown): void {
		if (!isEnvelopeReply(data)) return;
		const entry = this.pending.get(data.msg);
		if (!entry) return;
		this.pending.delete(data.msg);
		clearTimeout(entry.timeoutHandle);
		entry.resolve(data);
	}
}

function isEnvelopeReply(value: unknown): value is EnvelopeReply {
	if (!value || typeof value !== "object") return false;
	const r = value as Record<string, unknown>;
	if (r.v !== ENVELOPE_PROTOCOL_VERSION) return false;
	if (typeof r.msg !== "string") return false;
	if (r.ok === true) return true;
	if (r.ok === false) {
		const error = r.error as Record<string, unknown> | undefined;
		return Boolean(error && typeof error.kind === "string" && typeof error.message === "string");
	}
	return false;
}
