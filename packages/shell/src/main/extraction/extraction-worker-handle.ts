/**
 * Main-side handle for the extraction utility worker (Net-2b). Wraps a
 * `WorkerBridge` with a **single-in-flight, bounded FIFO queue**: extraction is
 * CPU-bound and the worker is single-threaded, so requests are serialized; the
 * backlog is capped (default 8) and, when full, the **oldest queued** request
 * is rejected so a flood of bookmark saves can't pile up unbounded (mirrors the
 * ydoc-worker LRU drop). The in-flight request is never dropped.
 *
 * The network service (Net-2c) owns the fetch leg and calls `extract` here with
 * the already-fetched HTML.
 */

import { ENVELOPE_PROTOCOL_VERSION, type Envelope, type EnvelopeReply } from "../../ipc/envelope";
import type { ExtractionResult } from "../../workers/extraction/index";

/** The slice of `WorkerBridge` this handle needs (injectable for tests). */
export type ExtractionBridge = {
	send(envelope: Envelope, options?: { timeoutMs?: number }): Promise<EnvelopeReply>;
};

export type ExtractInput = { html: string; baseUrl: string };

export type ExtractionWorkerHandle = {
	extract(input: ExtractInput, options?: { timeoutMs?: number }): Promise<ExtractionResult>;
};

const DEFAULT_QUEUE_CAP = 8;
/** Default extraction timeout — generous over the in-worker parse budget so a
 *  pathological page aborts rather than wedging the queue. */
const DEFAULT_TIMEOUT_MS = 10_000;

const SHELL_APP = "_shell";

export class ExtractionQueueFullError extends Error {
	constructor() {
		super("extraction queue full — request dropped (oldest evicted)");
		this.name = "Unavailable";
	}
}

type Job = {
	input: ExtractInput;
	timeoutMs: number;
	resolve: (value: ExtractionResult) => void;
	reject: (error: Error) => void;
};

export function createExtractionWorkerHandle(
	bridge: ExtractionBridge,
	options: { queueCap?: number; defaultTimeoutMs?: number } = {},
): ExtractionWorkerHandle {
	const cap = Math.max(1, options.queueCap ?? DEFAULT_QUEUE_CAP);
	const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
	const queue: Job[] = [];
	let running = false;
	let seq = 0;

	const pump = (): void => {
		if (running) return;
		const job = queue.shift();
		if (job === undefined) return;
		running = true;
		seq += 1;
		const envelope: Envelope = {
			v: ENVELOPE_PROTOCOL_VERSION,
			msg: `extract-${seq}`,
			app: SHELL_APP,
			service: "extraction",
			method: "extract",
			args: [job.input],
			caps: [],
		};
		bridge
			.send(envelope, { timeoutMs: job.timeoutMs })
			.then((reply) => {
				if (reply.ok) {
					job.resolve(reply.value as ExtractionResult);
				} else {
					const error = new Error(reply.error.message);
					error.name = reply.error.kind;
					job.reject(error);
				}
			})
			.catch((error: unknown) => {
				job.reject(error instanceof Error ? error : new Error(String(error)));
			})
			.finally(() => {
				running = false;
				pump();
			});
	};

	return {
		extract(input, callOptions = {}) {
			return new Promise<ExtractionResult>((resolve, reject) => {
				// Bound the backlog — evict the OLDEST *queued* (never the in-flight)
				// job so recent saves win and the queue can't grow without limit.
				while (queue.length >= cap) {
					queue.shift()?.reject(new ExtractionQueueFullError());
				}
				queue.push({
					input,
					timeoutMs: callOptions.timeoutMs ?? defaultTimeoutMs,
					resolve,
					reject,
				});
				pump();
			});
		},
	};
}
