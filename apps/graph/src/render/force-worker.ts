/**
 * Force-layout Web Worker entry (9.13.5).
 *
 * Owns one `ForceEngine` and pumps it on a `setInterval` so the entire
 * d3-style simulation — the synchronous `preConverge` warm-start *and*
 * the per-tick cooling — runs off the renderer's main thread. Node
 * positions stream back as a transferable `Float32Array`; the UI thread
 * only ever copies the latest frame into its render mirror and paints.
 *
 * Glue only — all simulation logic lives in `force-engine.ts` /
 * `force-layout.ts` (both pure + unit-tested). Kept deliberately tiny.
 */

import { ForceEngine } from "./force-engine";
import type { LayoutParams } from "./force-layout";
import type { WorkerInbound, WorkerOutbound } from "./force-protocol";

const TICK_MS = 16;

let engine: ForceEngine | null = null;
let epoch = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function post(msg: WorkerOutbound, transfer?: Transferable[]): void {
	(self as unknown as Worker).postMessage(msg, transfer ?? []);
}

function emitFrame(): void {
	if (!engine) return;
	const pos = engine.readPositions();
	post({ type: "frame", epoch, alpha: engine.alpha, pos }, [pos.buffer]);
}

function stopPump(): void {
	if (timer !== null) {
		clearInterval(timer);
		timer = null;
	}
}

function ensurePump(): void {
	if (timer !== null || !engine) return;
	timer = setInterval(() => {
		if (!engine) return;
		// Budget a slice per interval (blocking in a worker is fine — the
		// UI thread is untouched) so a big graph converges in ~1 s of wall
		// time instead of 300 single ticks at 16 ms ≈ 5 s.
		const warm = engine.stepFor(TICK_MS);
		emitFrame();
		if (!warm) stopPump();
	}, TICK_MS);
}

self.onmessage = (ev: MessageEvent<WorkerInbound>) => {
	const msg = ev.data;
	switch (msg.type) {
		case "init":
			engine = new ForceEngine(msg.params as LayoutParams);
			// Liveness handshake: the driver degrades to the on-thread engine
			// if it never hears back (a Blob worker that silently fails to
			// run under `file://` throws no error — without this ping the
			// driver would repaint every frame forever waiting on it).
			post({ type: "ready" });
			break;
		case "reset": {
			if (!engine) engine = new ForceEngine(msg.params);
			else engine.setParams(msg.params);
			epoch = msg.epoch;
			engine.reset(msg.graph);
			// Always emit one frame so the consumer gets the (already
			// pre-converged) layout immediately, then keep pumping if the
			// reheat left it warm.
			emitFrame();
			if (engine.warm) ensurePump();
			else stopPump();
			break;
		}
		case "fixed":
			if (engine && msg.epoch === epoch) {
				engine.setFixed(msg.items);
				ensurePump();
			}
			break;
		case "reheat":
			if (engine && msg.epoch === epoch) {
				engine.reheat(msg.alpha);
				ensurePump();
			}
			break;
		case "params":
			if (engine) {
				engine.setParams(msg.params);
				ensurePump();
			}
			break;
		case "dispose":
			stopPump();
			engine = null;
			break;
	}
};
