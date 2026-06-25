/**
 * Sample statistics — pure functions over a measurement array.
 *
 * The IPC RTT budget is split median (<2ms) + p99 (<8ms) per
 * `docs/shell/12-shell-architecture.md §Performance budgets`; everything else
 * asserts against the median. p99 is here for the IPC spec; median/min/max/
 * mean are universal.
 */

export type SampleStats = {
	readonly samples: number;
	readonly min: number;
	readonly median: number;
	readonly p95: number;
	readonly p99: number;
	readonly max: number;
	readonly mean: number;
};

function percentile(sortedAsc: readonly number[], q: number): number {
	if (sortedAsc.length === 0) return 0;
	if (sortedAsc.length === 1) return sortedAsc[0] ?? 0;
	const rank = q * (sortedAsc.length - 1);
	const lo = Math.floor(rank);
	const hi = Math.ceil(rank);
	const loVal = sortedAsc[lo] ?? 0;
	const hiVal = sortedAsc[hi] ?? loVal;
	const frac = rank - lo;
	return loVal + (hiVal - loVal) * frac;
}

export function summarize(measurements: readonly number[]): SampleStats {
	if (measurements.length === 0) {
		return { samples: 0, min: 0, median: 0, p95: 0, p99: 0, max: 0, mean: 0 };
	}
	const sorted = [...measurements].sort((a, b) => a - b);
	const len = sorted.length;
	const min = sorted[0] ?? 0;
	const max = sorted[len - 1] ?? 0;
	const median = percentile(sorted, 0.5);
	const p95 = percentile(sorted, 0.95);
	const p99 = percentile(sorted, 0.99);
	const mean = measurements.reduce((acc, n) => acc + n, 0) / len;
	return { samples: len, min, median, p95, p99, max, mean };
}

export function formatStats(stats: SampleStats): string {
	return (
		`min=${stats.min.toFixed(2)}ms ` +
		`median=${stats.median.toFixed(2)}ms ` +
		`p95=${stats.p95.toFixed(2)}ms ` +
		`p99=${stats.p99.toFixed(2)}ms ` +
		`max=${stats.max.toFixed(2)}ms ` +
		`n=${stats.samples}`
	);
}
