/**
 * Feedback-2 — `CrashQueue` disk persistence tests.
 *
 * Atomic write semantics, malformed-file tolerance, prune ordering,
 * idempotent remove.
 */

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CrashKind, type CrashPayload, RendererReason } from "./crash-payload";
import { CRASH_QUEUE_DEFAULT_MAX_AGE_MS, CrashQueue, crashQueueDir } from "./crash-queue";

let dir: string;

function makePayload(overrides: Partial<CrashPayload> = {}): CrashPayload {
	return {
		kind: CrashKind.UncaughtException,
		message: "boom",
		recentLogExcerpt: "",
		clientVersion: "test-build",
		clientPlatform: "darwin",
		capturedAt: 1_700_000_000_000,
		requestId: `req_${Math.random().toString(36).slice(2)}`,
		installationId: "install-id",
		durationSinceBootMs: 1_000,
		...overrides,
	};
}

beforeEach(async () => {
	const root = await fs.mkdtemp(join(tmpdir(), "crash-queue-"));
	dir = join(root, "crash-reports");
});

afterEach(async () => {
	try {
		await fs.rm(dir, { recursive: true, force: true });
	} catch {
		// best-effort cleanup
	}
});

describe("CrashQueue.enqueue + pending", () => {
	it("persists one file per crash", async () => {
		const q = new CrashQueue({ dir });
		await q.enqueue(makePayload({ requestId: "r1" }));
		await q.enqueue(makePayload({ requestId: "r2" }));
		const entries = await fs.readdir(dir);
		expect(entries.filter((e) => e.endsWith(".json"))).toHaveLength(2);
	});

	it("returns newest first", async () => {
		const q = new CrashQueue({ dir });
		await q.enqueue(makePayload({ requestId: "r1", capturedAt: 1000 }));
		await q.enqueue(makePayload({ requestId: "r2", capturedAt: 5000 }));
		await q.enqueue(makePayload({ requestId: "r3", capturedAt: 3000 }));
		const pending = await q.pending();
		expect(pending.map((p) => p.requestId)).toEqual(["r2", "r3", "r1"]);
	});

	it("returns empty array when the directory does not exist", async () => {
		const q = new CrashQueue({ dir });
		const pending = await q.pending();
		expect(pending).toEqual([]);
	});

	it("survives a malformed JSON file with a single warn", async () => {
		const q = new CrashQueue({ dir });
		await q.enqueue(makePayload({ requestId: "good" }));
		await fs.writeFile(join(dir, "bad.json"), "{ not json", "utf8");
		const warn = vi.fn();
		const q2 = new CrashQueue({ dir, warn });
		const pending = await q2.pending();
		expect(pending).toHaveLength(1);
		expect(pending[0]?.requestId).toBe("good");
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it("skips files that parse but fail validation", async () => {
		const q = new CrashQueue({ dir });
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(join(dir, "invalid.json"), JSON.stringify({ kind: "nope" }), "utf8");
		const warn = vi.fn();
		const q2 = new CrashQueue({ dir, warn });
		const pending = await q2.pending();
		expect(pending).toHaveLength(0);
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it("does not throw on unrelated files in the directory", async () => {
		const q = new CrashQueue({ dir });
		await q.enqueue(makePayload({ requestId: "r1" }));
		await fs.writeFile(join(dir, "README.txt"), "ignore me", "utf8");
		const pending = await q.pending();
		expect(pending).toHaveLength(1);
	});

	it("sanitises requestId for the on-disk path", async () => {
		const q = new CrashQueue({ dir });
		await q.enqueue(makePayload({ requestId: "weird/../id" }));
		const entries = await fs.readdir(dir);
		expect(entries.every((e) => !e.includes("/"))).toBe(true);
		expect(entries.some((e) => e.endsWith(".json"))).toBe(true);
	});
});

describe("CrashQueue.remove + clearAll + count", () => {
	it("remove drops one file", async () => {
		const q = new CrashQueue({ dir });
		await q.enqueue(makePayload({ requestId: "r1" }));
		await q.enqueue(makePayload({ requestId: "r2" }));
		await q.remove("r1");
		const pending = await q.pending();
		expect(pending.map((p) => p.requestId)).toEqual(["r2"]);
	});

	it("remove is idempotent — missing file is a no-op", async () => {
		const q = new CrashQueue({ dir });
		await expect(q.remove("never-existed")).resolves.toBeUndefined();
	});

	it("clearAll drops every queued report", async () => {
		const q = new CrashQueue({ dir });
		await q.enqueue(makePayload({ requestId: "r1" }));
		await q.enqueue(makePayload({ requestId: "r2" }));
		await q.enqueue(makePayload({ requestId: "r3" }));
		const dropped = await q.clearAll();
		expect(dropped).toBe(3);
		expect(await q.pending()).toEqual([]);
	});

	it("count returns 0 for a missing directory", async () => {
		const q = new CrashQueue({ dir });
		expect(await q.count()).toBe(0);
	});

	it("count returns the on-disk count without parsing", async () => {
		const q = new CrashQueue({ dir });
		await q.enqueue(makePayload({ requestId: "r1" }));
		await q.enqueue(makePayload({ requestId: "r2" }));
		expect(await q.count()).toBe(2);
	});
});

describe("CrashQueue.prune", () => {
	it("drops reports older than maxAgeMs", async () => {
		const q = new CrashQueue({ dir });
		const now = 10 * CRASH_QUEUE_DEFAULT_MAX_AGE_MS;
		await q.enqueue(makePayload({ requestId: "fresh", capturedAt: now - 1_000 }));
		await q.enqueue(
			makePayload({
				requestId: "stale",
				capturedAt: now - CRASH_QUEUE_DEFAULT_MAX_AGE_MS - 10_000,
			}),
		);
		const removed = await q.prune(CRASH_QUEUE_DEFAULT_MAX_AGE_MS, 100, now);
		expect(removed).toBe(1);
		const pending = await q.pending();
		expect(pending.map((p) => p.requestId)).toEqual(["fresh"]);
	});

	it("respects maxCount, keeping the newest", async () => {
		const q = new CrashQueue({ dir });
		const base = 1_700_000_000_000;
		for (let i = 0; i < 5; i++) {
			await q.enqueue(makePayload({ requestId: `r${i}`, capturedAt: base + i * 1_000 }));
		}
		const removed = await q.prune(CRASH_QUEUE_DEFAULT_MAX_AGE_MS, 2, base + 10_000);
		expect(removed).toBe(3);
		const pending = await q.pending();
		expect(pending.map((p) => p.requestId)).toEqual(["r4", "r3"]);
	});

	it("is a no-op when nothing is stale and under cap", async () => {
		const q = new CrashQueue({ dir });
		await q.enqueue(makePayload({ requestId: "r1", capturedAt: 1_700_000_000_000 }));
		const removed = await q.prune(CRASH_QUEUE_DEFAULT_MAX_AGE_MS, 100, 1_700_000_001_000);
		expect(removed).toBe(0);
	});
});

describe("crashQueueDir", () => {
	it("joins userData with the canonical subdir", () => {
		expect(crashQueueDir("/u/data")).toBe(join("/u/data", "crash-reports"));
	});
});

describe("CrashQueue persistence round-trip", () => {
	it("preserves every populated field across write→read", async () => {
		const q = new CrashQueue({ dir });
		const payload = makePayload({
			kind: CrashKind.RendererCrashed,
			rendererReason: RendererReason.OutOfMemory,
			exitCode: 137,
			stack: "Error: x\n    at /<vault>/x.js:1:1",
			appId: "notes",
			routePath: "/n/1",
			recentLogExcerpt: "log",
			requestId: "round_trip",
		});
		await q.enqueue(payload);
		const pending = await q.pending();
		expect(pending).toHaveLength(1);
		expect(pending[0]).toEqual(payload);
	});
});
