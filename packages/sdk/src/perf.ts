/**
 * Tiny performance-instrumentation helper.
 *
 * Apps (and the shell) tag hot paths with `time(name, fn)` or
 * `mark`/`measure`. Records flow through the standard `performance` API
 * so DevTools' Performance tab picks them up, and into a small in-memory
 * ring buffer so tests can assert on the last N measures without touching
 * `performance.getEntries()` (which is dirty across the whole app).
 *
 * Designed to be no-op-safe when `performance.mark` is unavailable
 * (older test runners), and zero-allocation on the fast path when no
 * subscriber wants the measure.
 *
 * Brainstorm's per-frame budget is 16ms (doc 13 — keystroke→paint). The
 * helper exposes `subscribe({ thresholdMs }, cb)` so the renderer can
 * route over-budget measures into the error log without each call site
 * re-implementing the threshold check.
 */

export type PerfMeasure = {
	name: string;
	durationMs: number;
	startMs: number;
};

export type PerfSubscriber = (m: PerfMeasure) => void;

export type SubscribeOptions = {
	/** Only deliver measures whose duration exceeds this threshold. */
	thresholdMs?: number;
	/** Only deliver measures whose name matches this prefix. */
	prefix?: string;
};

const RING_SIZE = 64;
const ring: PerfMeasure[] = [];
const subscribers: { opts: SubscribeOptions; fn: PerfSubscriber }[] = [];

const PERF: Performance | undefined = typeof performance !== "undefined" ? performance : undefined;

export function now(): number {
	return PERF ? PERF.now() : Date.now();
}

export function mark(name: string): void {
	try {
		PERF?.mark(name);
	} catch {
		/* swallow — duplicate names in environments that error on duplicates */
	}
}

/** Record a measure between two marks (or now-startMs). */
export function measure(name: string, startMs: number, endMs: number = now()): PerfMeasure {
	const m: PerfMeasure = { name, durationMs: Math.max(0, endMs - startMs), startMs };
	recordMeasure(m);
	return m;
}

/** Wrap a synchronous block; emits the measure and returns the value. */
export function time<T>(name: string, fn: () => T): T {
	const start = now();
	try {
		return fn();
	} finally {
		measure(name, start);
	}
}

/** Wrap an async block. Captures duration even if `fn` rejects. */
export async function timeAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
	const start = now();
	try {
		return await fn();
	} finally {
		measure(name, start);
	}
}

export function recent(limit = ring.length): ReadonlyArray<PerfMeasure> {
	return limit >= ring.length ? ring.slice() : ring.slice(-limit);
}

export function clearRecent(): void {
	ring.length = 0;
}

export function subscribe(opts: SubscribeOptions, fn: PerfSubscriber): () => void {
	const entry = { opts, fn };
	subscribers.push(entry);
	return () => {
		const i = subscribers.indexOf(entry);
		if (i >= 0) subscribers.splice(i, 1);
	};
}

function recordMeasure(m: PerfMeasure): void {
	ring.push(m);
	if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE);
	for (const s of subscribers) {
		if (s.opts.thresholdMs !== undefined && m.durationMs < s.opts.thresholdMs) continue;
		if (s.opts.prefix !== undefined && !m.name.startsWith(s.opts.prefix)) continue;
		try {
			s.fn(m);
		} catch {
			/* never let subscriber failure poison the measured call site */
		}
	}
}
