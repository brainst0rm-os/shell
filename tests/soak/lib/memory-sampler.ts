/**
 * Stage 10.9a — main-process RSS sampler + slope estimator for the soak
 * harness. Samples each shell's `process.memoryUsage().rss` (main, not
 * renderer) every 60 s during the soak window and reports a linear
 * regression slope in MB/min after the window closes.
 *
 * Why main-process RSS: the renderer's `performance.memory` is a noisy
 * Chrome diagnostic and the renderer holds CRDT state in V8; main-process
 * RSS aggregates the storage worker + ydoc worker + the broker. Soak's
 * pass criterion is `<1MB/min` on the linear fit, calibrated from the
 * 15-min mode and re-evaluated after the 8 h run lands (see OQ-231).
 */

import type { ElectronApplication } from "@playwright/test";

export type MemorySample = {
	readonly atMs: number;
	readonly rssBytes: number;
};

export type MemoryRegression = {
	readonly samples: number;
	readonly slopeBytesPerMs: number;
	readonly slopeMbPerMinute: number;
	readonly interceptBytes: number;
};

export type MemorySampler = {
	stop(): Promise<MemorySample[]>;
};

export function startMemorySampler(app: ElectronApplication, intervalMs = 60_000): MemorySampler {
	const samples: MemorySample[] = [];
	let stopped = false;
	const start = Date.now();

	const tick = async (): Promise<void> => {
		if (stopped) return;
		try {
			const rss = await app.evaluate(() => process.memoryUsage().rss);
			samples.push({ atMs: Date.now() - start, rssBytes: rss });
		} catch {
			// Process may be tearing down; swallow + let the next tick decide.
		}
	};

	void tick();
	const handle = setInterval(() => {
		void tick();
	}, intervalMs);

	return {
		async stop(): Promise<MemorySample[]> {
			stopped = true;
			clearInterval(handle);
			await tick();
			return samples.slice();
		},
	};
}

export function regressionFromSamples(samples: readonly MemorySample[]): MemoryRegression {
	if (samples.length < 2) {
		return {
			samples: samples.length,
			slopeBytesPerMs: 0,
			slopeMbPerMinute: 0,
			interceptBytes: samples[0]?.rssBytes ?? 0,
		};
	}
	let sumX = 0;
	let sumY = 0;
	let sumXY = 0;
	let sumXX = 0;
	for (const s of samples) {
		sumX += s.atMs;
		sumY += s.rssBytes;
		sumXY += s.atMs * s.rssBytes;
		sumXX += s.atMs * s.atMs;
	}
	const n = samples.length;
	const denom = n * sumXX - sumX * sumX;
	const slopeBytesPerMs = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
	const interceptBytes = (sumY - slopeBytesPerMs * sumX) / n;
	const slopeMbPerMinute = (slopeBytesPerMs * 60_000) / (1024 * 1024);
	return { samples: n, slopeBytesPerMs, slopeMbPerMinute, interceptBytes };
}
