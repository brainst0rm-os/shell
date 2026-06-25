import { afterEach, describe, expect, it, vi } from "vitest";
import type { Envelope, EnvelopeReply } from "../../ipc/envelope";
import {
	type ExtractionBridge,
	ExtractionQueueFullError,
	createExtractionWorkerHandle,
} from "./extraction-worker-handle";

/** A bridge whose `send` is manually settled, so we can observe in-flight /
 *  queued state precisely. */
function deferredBridge() {
	const pending: Array<{ envelope: Envelope; settle: (reply: EnvelopeReply) => void }> = [];
	const bridge: ExtractionBridge = {
		send(envelope) {
			return new Promise<EnvelopeReply>((resolve) => {
				pending.push({ envelope, settle: resolve });
			});
		},
	};
	const ok = (msg: string, value: unknown): EnvelopeReply => ({ v: 1, msg, ok: true, value });
	return { bridge, pending, ok };
}

const RESULT = { meta: null, blocks: null, textContent: "" };
const input = { html: "<p>x</p>", baseUrl: "https://x.test" };
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.restoreAllMocks());

describe("createExtractionWorkerHandle", () => {
	it("is single-in-flight — serializes concurrent extracts", async () => {
		const { bridge, pending, ok } = deferredBridge();
		const handle = createExtractionWorkerHandle(bridge);

		const a = handle.extract(input);
		const b = handle.extract(input);
		const c = handle.extract(input);
		await flush();
		// Only ONE request is in flight despite three calls.
		expect(pending.length).toBe(1);

		pending[0]?.settle(ok(pending[0].envelope.msg, RESULT));
		await expect(a).resolves.toEqual(RESULT);
		await flush();
		expect(pending.length).toBe(2); // next dequeued
		pending[1]?.settle(ok(pending[1].envelope.msg, RESULT));
		await b;
		await flush();
		pending[2]?.settle(ok(pending[2].envelope.msg, RESULT));
		await expect(c).resolves.toEqual(RESULT);
	});

	it("resolves with the reply value and rejects with the error kind", async () => {
		const { bridge, pending, ok } = deferredBridge();
		const handle = createExtractionWorkerHandle(bridge);

		const good = handle.extract(input);
		await flush();
		pending[0]?.settle(ok(pending[0].envelope.msg, { meta: null, blocks: [], textContent: "hi" }));
		await expect(good).resolves.toMatchObject({ textContent: "hi" });

		const bad = handle.extract(input);
		await flush();
		pending[1]?.settle({
			v: 1,
			msg: pending[1].envelope.msg,
			ok: false,
			error: { kind: "Timeout", message: "too slow" },
		});
		await expect(bad).rejects.toMatchObject({ name: "Timeout", message: "too slow" });
	});

	it("bounds the backlog — evicting the oldest queued job when full", async () => {
		const { bridge, pending } = deferredBridge();
		const handle = createExtractionWorkerHandle(bridge, { queueCap: 2 });

		const inFlight = handle.extract(input); // dequeued immediately (in flight)
		const q1 = handle.extract(input); // queued
		const q2 = handle.extract(input); // queued (queue now at cap 2)
		const q3 = handle.extract(input); // pushes over cap → evicts oldest queued (q1)

		await expect(q1).rejects.toBeInstanceOf(ExtractionQueueFullError);
		await flush();
		expect(pending.length).toBe(1); // still only the in-flight one
		// in-flight + q2 + q3 are still live (not rejected) — silence the floating
		// promises by attaching no-op catches.
		void inFlight.catch(() => {});
		void q2.catch(() => {});
		void q3.catch(() => {});
	});

	it("passes a per-call timeout through to the bridge", async () => {
		const send = vi.fn((_e: Envelope): Promise<EnvelopeReply> => new Promise(() => {}));
		const handle = createExtractionWorkerHandle({ send });
		void handle.extract(input, { timeoutMs: 1234 }).catch(() => {});
		await flush();
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({ service: "extraction", method: "extract" }),
			{ timeoutMs: 1234 },
		);
	});
});
