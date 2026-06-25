/**
 * Stage 10.9a — keystroke-cadence generator for the soak harness.
 *
 * Two real shells type into the same entity concurrently for the soak
 * window. Baseline cadence is 5 Hz per side; every 30 s one side
 * performs a structural edit (insert a heading, delete a line) so the
 * load exercises both the steady-state and the worst-case CRDT
 * conflict-resolution paths.
 *
 * Each side weaves its canary string into the typed payload at
 * deterministic intervals; the post-soak audit-log grep proves the
 * canary never survived in plaintext across the relay-blind wire.
 *
 * The function returns once `durationMs` elapses; callers `await` it
 * so the soak spec can serialize "type → assert".
 */

import type { Page } from "@playwright/test";

export type TypingLoadOptions = {
	readonly shellA: Page;
	readonly shellB: Page;
	readonly entityId: string;
	readonly canaryA: string;
	readonly canaryB: string;
	readonly durationMs: number;
	readonly keystrokeHz?: number;
	readonly structuralEveryMs?: number;
	readonly onProgress?: (elapsedMs: number, durationMs: number) => void;
	/**
	 * Caller-provided collector. Each successful `appendText` keystroke's
	 * elapsed wall time (ms, from `performance.now()`) is appended in order.
	 * Required so gate 4 (median <17ms) is meaningful — the previous shape
	 * had no out-channel, so the spec computed `median([0])` regardless of
	 * actual perf.
	 */
	readonly keystrokeTimings: number[];
};

export async function runTypingLoad(opts: TypingLoadOptions): Promise<void> {
	const keystrokeIntervalMs = 1000 / (opts.keystrokeHz ?? 5);
	const structuralEveryMs = opts.structuralEveryMs ?? 30_000;

	const start = Date.now();
	const deadline = start + opts.durationMs;
	let lastStructural = start;
	let lastProgress = start;
	let tick = 0;

	while (Date.now() < deadline) {
		const tickStart = Date.now();
		const isCanaryTick = tick % 10 === 0;
		await Promise.all([
			emitKeystroke(
				opts.shellA,
				opts.entityId,
				isCanaryTick ? opts.canaryA : pickPrintable(tick),
				opts.keystrokeTimings,
			),
			emitKeystroke(
				opts.shellB,
				opts.entityId,
				isCanaryTick ? opts.canaryB : pickPrintable(tick + 1),
				opts.keystrokeTimings,
			),
		]);

		if (Date.now() - lastStructural >= structuralEveryMs) {
			await emitStructural(opts.shellA, opts.entityId);
			lastStructural = Date.now();
		}

		if (opts.onProgress && Date.now() - lastProgress >= 5_000) {
			opts.onProgress(Date.now() - start, opts.durationMs);
			lastProgress = Date.now();
		}

		const elapsed = Date.now() - tickStart;
		const waitMs = Math.max(0, keystrokeIntervalMs - elapsed);
		if (waitMs > 0) await sleep(waitMs);
		tick++;
	}
}

async function emitKeystroke(
	page: Page,
	entityId: string,
	text: string,
	timings: number[],
): Promise<void> {
	const t0 = performance.now();
	await page.evaluate(
		async ({ id, t }) => {
			const w = window as unknown as {
				brainstorm?: { dev?: { appendText?: (entityId: string, text: string) => Promise<void> } };
			};
			const fn = w.brainstorm?.dev?.appendText;
			if (!fn) throw new Error("bs.dev.appendText unavailable (BRAINSTORM_SOAK_DEBUG=1?)");
			await fn(id, t);
		},
		{ id: entityId, t: text },
	);
	timings.push(performance.now() - t0);
}

async function emitStructural(page: Page, entityId: string): Promise<void> {
	await page.evaluate(async (id: string) => {
		const w = window as unknown as {
			brainstorm?: { dev?: { structuralEdit?: (entityId: string) => Promise<void> } };
		};
		const fn = w.brainstorm?.dev?.structuralEdit;
		if (!fn) throw new Error("bs.dev.structuralEdit unavailable (BRAINSTORM_SOAK_DEBUG=1?)");
		await fn(id);
	}, entityId);
}

function pickPrintable(seed: number): string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz ";
	return alphabet.charAt(seed % alphabet.length);
}

function sleep(ms: number): Promise<void> {
	return new Promise((res) => setTimeout(res, ms));
}
