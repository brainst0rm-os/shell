/**
 * Feedback-2 — on-disk crash queue.
 *
 * Crashes can fire when the network is unreachable, when the user has
 * just opted in (so a previously-rejected report can now go out), or
 * during shutdown. We persist every captured crash as a single JSON file
 * under `<userData>/crash-reports/<requestId>.json` and replay the queue
 * after each reboot.
 *
 * One file per crash keeps writes atomic: an `fsync` after the open
 * write guarantees either-empty-or-fully-present semantics, and a
 * crashed write doesn't corrupt the sibling files. A malformed file
 * on read is logged + skipped (the queue stays a live signal, not a
 * brittle journal).
 *
 * Pruning runs on `before-quit` per the iteration spec: any report
 * older than 30 days OR past the 100-entry ceiling drops (newest
 * retained). Two-axis cap keeps the queue bounded under a runaway loop
 * that fires hundreds of crashes per minute.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { type CrashPayload, validateCrashPayload } from "./crash-payload";

export const CRASH_QUEUE_DIR_NAME = "crash-reports";
export const CRASH_QUEUE_DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const CRASH_QUEUE_DEFAULT_MAX_COUNT = 100;

export type CrashQueueOptions = {
	/** Absolute path to the queue directory (e.g.
	 *  `<userData>/crash-reports`). Created on demand. */
	readonly dir: string;
	/** Optional warning sink — defaults to `console.warn` so a missed
	 *  malformed file shows up in the diagnostics sink that already
	 *  capture-tees console.* to the NDJSON error log. */
	readonly warn?: (message: string) => void;
};

export class CrashQueue {
	private readonly dir: string;
	private readonly warn: (message: string) => void;

	constructor(options: CrashQueueOptions) {
		this.dir = options.dir;
		this.warn = options.warn ?? ((m) => console.warn(`[crash-queue] ${m}`));
	}

	/** Persist a crash payload as `<dir>/<requestId>.json`. The write is
	 *  atomic: the file is written to a sibling `.tmp` path and renamed
	 *  on top of the target. On any failure we leave no half-written
	 *  file behind. The caller catches errors — a queue write that
	 *  itself crashes must not crash the crash reporter (the service
	 *  wraps every queue call in try/catch). */
	async enqueue(payload: CrashPayload): Promise<void> {
		await fs.mkdir(this.dir, { recursive: true });
		const target = this.pathFor(payload.requestId);
		const tmp = `${target}.tmp`;
		const serialised = `${JSON.stringify(payload, null, "\t")}\n`;
		let handle: fs.FileHandle | null = null;
		try {
			handle = await fs.open(tmp, "w");
			await handle.writeFile(serialised, "utf8");
			await handle.sync();
		} finally {
			await handle?.close().catch(() => undefined);
		}
		await fs.rename(tmp, target);
	}

	/** List all queued payloads, newest first. Skips malformed files and
	 *  emits a single warn per skip so the diagnostics sink records a
	 *  signal but we never throw out of the queue read path. */
	async pending(): Promise<readonly CrashPayload[]> {
		let entries: readonly string[];
		try {
			entries = await fs.readdir(this.dir);
		} catch (error) {
			if (isEnoent(error)) return [];
			throw error;
		}
		const payloads: CrashPayload[] = [];
		for (const entry of entries) {
			if (!entry.endsWith(".json")) continue;
			const fullPath = join(this.dir, entry);
			let raw: string;
			try {
				raw = await fs.readFile(fullPath, "utf8");
			} catch (error) {
				if (isEnoent(error)) continue;
				this.warn(`failed to read ${entry}: ${(error as Error).message}`);
				continue;
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch (_error) {
				this.warn(`malformed JSON in ${entry}; skipping`);
				continue;
			}
			const validated = validateCrashPayload(parsed);
			if (!validated.ok) {
				this.warn(`invalid payload in ${entry}: ${validated.detail}`);
				continue;
			}
			payloads.push(validated.payload);
		}
		payloads.sort((a, b) => b.capturedAt - a.capturedAt);
		return payloads;
	}

	/** Remove one queued payload by request id. Idempotent — a missing
	 *  file is treated as already-removed (the submitter races with
	 *  prune; treat ENOENT as a no-op). */
	async remove(requestId: string): Promise<void> {
		try {
			await fs.unlink(this.pathFor(requestId));
		} catch (error) {
			if (isEnoent(error)) return;
			throw error;
		}
	}

	/** Drop everything in the queue. Used by the "Clear all" UI action. */
	async clearAll(): Promise<number> {
		let entries: readonly string[];
		try {
			entries = await fs.readdir(this.dir);
		} catch (error) {
			if (isEnoent(error)) return 0;
			throw error;
		}
		let count = 0;
		for (const entry of entries) {
			if (!entry.endsWith(".json")) continue;
			try {
				await fs.unlink(join(this.dir, entry));
				count++;
			} catch (error) {
				if (isEnoent(error)) continue;
				this.warn(`failed to remove ${entry}: ${(error as Error).message}`);
			}
		}
		return count;
	}

	/** Drop reports older than `maxAgeMs` OR past the `maxCount` ceiling
	 *  (keeping the newest). Returns the number of entries removed. */
	async prune(
		maxAgeMs: number = CRASH_QUEUE_DEFAULT_MAX_AGE_MS,
		maxCount: number = CRASH_QUEUE_DEFAULT_MAX_COUNT,
		now: number = Date.now(),
	): Promise<number> {
		const entries = await this.pending();
		const survivors: CrashPayload[] = [];
		const stale: CrashPayload[] = [];
		for (const p of entries) {
			if (now - p.capturedAt > maxAgeMs) stale.push(p);
			else survivors.push(p);
		}
		const overflow = survivors.slice(maxCount);
		const toDelete = [...stale, ...overflow];
		for (const p of toDelete) {
			await this.remove(p.requestId);
		}
		return toDelete.length;
	}

	/** Count without parsing every payload — cheap for the IPC pending-
	 *  count channel. Falls back to `pending().length` if the directory
	 *  can't be enumerated (covered by `pending`'s ENOENT short-circuit). */
	async count(): Promise<number> {
		try {
			const entries = await fs.readdir(this.dir);
			return entries.filter((e) => e.endsWith(".json")).length;
		} catch (error) {
			if (isEnoent(error)) return 0;
			throw error;
		}
	}

	private pathFor(requestId: string): string {
		const safe = requestId.replace(/[^A-Za-z0-9_-]/g, "_");
		return join(this.dir, `${safe}.json`);
	}
}

/** Canonical path under userData. */
export function crashQueueDir(userDataDir: string): string {
	return join(userDataDir, CRASH_QUEUE_DIR_NAME);
}

function isEnoent(error: unknown): boolean {
	return Boolean(error) && (error as { code?: string }).code === "ENOENT";
}
