/**
 * Stage 10.3b — per-(sender, entityId) sequence-window tracker for
 * replay-drop on inbound envelopes.
 *
 * Each (sender pubkey, entityId) pair gets its own sliding-window state:
 *
 *   - `highest`  — the highest `seq` ever seen for this pair.
 *   - `bitmap`   — 64-bit BigInt; bit `n` set means
 *                  `highest - n` was already accepted. Bit 0 is the
 *                  highest itself; rolling the window leftward shifts
 *                  the bitmap by the delta.
 *
 * `accept(sender, entityId, seq)` returns:
 *
 *   - `Fresh`        — first time we've seen this seq; state updated.
 *   - `Duplicate`    — seq is inside the window AND its bit was already set.
 *   - `OutOfWindow`  — `highest - seq >= WINDOW_BITS` (too old to dedupe
 *                       authoritatively → reject conservatively).
 *
 * `nextSeq(sender, entityId)` is the producer side: returns the next
 * monotonic counter for an outbound envelope this device originates.
 * Persisted alongside the receive state so that a vault re-open does
 * not restart the counter at zero (which would collide with seqs the
 * paired devices have already accepted).
 *
 * Persistence: one JSON file at `<vault>/sync/seq.json`. Writes are
 * serialised through a chained Promise so concurrent `accept`/`nextSeq`
 * calls cannot interleave and clobber state. Window default is 64
 * (sized for typical reordering on the relay; configurable for tests).
 *
 * Per OQ-194 (resolved 2026-05-23) per-(sender, entityId) granularity
 * is the smallest replay-window unit that gives a correct one-shot
 * dup-drop without coupling unrelated entities' replay state.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { bytesToBase64 } from "../credentials/crypto";

export enum SeqAcceptance {
	Fresh = "fresh",
	Duplicate = "duplicate",
	OutOfWindow = "out-of-window",
}

export const SEQ_TRACKER_FILENAME = "seq.json";
export const DEFAULT_WINDOW_BITS = 64;
const FORMAT_VERSION = 1;

type ReceiveState = {
	highest: number;
	bitmap: bigint;
};

type SerializedReceive = {
	highest: number;
	bitmapHex: string;
};

type SerializedFile = {
	version: typeof FORMAT_VERSION;
	receive: Record<string, SerializedReceive>;
	send: Record<string, number>;
};

export type SeqTrackerOptions = {
	/** Window in bits (default 64). A `seq` more than `windowBits - 1`
	 *  behind `highest` is rejected as `OutOfWindow`. */
	windowBits?: number;
	/** Override the on-disk path. Defaults to `<vault>/sync/seq.json`. */
	filePath?: string;
};

export function seqTrackerPath(vaultPath: string): string {
	return join(vaultPath, "sync", SEQ_TRACKER_FILENAME);
}

export class SeqTracker {
	private readonly windowBits: number;
	private readonly windowMask: bigint;
	private readonly filePath: string;
	private readonly receive = new Map<string, ReceiveState>();
	private readonly send = new Map<string, number>();
	private writeChain: Promise<void> = Promise.resolve();
	private disposed = false;

	private constructor(filePath: string, windowBits: number) {
		this.filePath = filePath;
		this.windowBits = windowBits;
		this.windowMask =
			windowBits >= 64 ? (1n << BigInt(windowBits)) - 1n : (1n << BigInt(windowBits)) - 1n;
	}

	/** Open (or create) the tracker for `vaultPath`. Loads any persisted
	 *  state — missing file is treated as an empty tracker, malformed JSON
	 *  is logged and treated as empty (the wire path stays available; a
	 *  corrupt seq file at worst re-allows one replay window of frames). */
	static async open(vaultPath: string, options: SeqTrackerOptions = {}): Promise<SeqTracker> {
		const windowBits = options.windowBits ?? DEFAULT_WINDOW_BITS;
		if (windowBits < 1 || windowBits > 64 || !Number.isInteger(windowBits)) {
			throw new Error(`SeqTracker: windowBits must be an integer in [1, 64], got ${windowBits}`);
		}
		const filePath = options.filePath ?? seqTrackerPath(vaultPath);
		const tracker = new SeqTracker(filePath, windowBits);
		await tracker.load();
		return tracker;
	}

	private async load(): Promise<void> {
		let raw: string;
		try {
			raw = await readFile(this.filePath, "utf8");
		} catch (error) {
			if (isNotFound(error)) return;
			console.warn(
				`[brainstorm] seq-tracker: read failed (${(error as Error).message}); starting empty`,
			);
			return;
		}
		let parsed: Partial<SerializedFile>;
		try {
			parsed = JSON.parse(raw) as Partial<SerializedFile>;
		} catch (error) {
			console.warn(
				`[brainstorm] seq-tracker: malformed JSON (${(error as Error).message}); starting empty`,
			);
			return;
		}
		if (!parsed || parsed.version !== FORMAT_VERSION) return;
		if (parsed.receive && typeof parsed.receive === "object") {
			for (const [key, value] of Object.entries(parsed.receive)) {
				if (!value || typeof value !== "object") continue;
				if (typeof value.highest !== "number" || !Number.isFinite(value.highest)) continue;
				if (typeof value.bitmapHex !== "string") continue;
				let bitmap: bigint;
				try {
					bitmap = BigInt(`0x${value.bitmapHex}`);
				} catch {
					continue;
				}
				this.receive.set(key, { highest: value.highest, bitmap: bitmap & this.windowMask });
			}
		}
		if (parsed.send && typeof parsed.send === "object") {
			for (const [key, value] of Object.entries(parsed.send)) {
				if (typeof value !== "number" || !Number.isFinite(value)) continue;
				this.send.set(key, value);
			}
		}
	}

	/** Producer-side counter for envelopes this device originates. The
	 *  first call for a `(sender, entityId)` pair returns 0; each
	 *  subsequent call returns +1. State persists so reopening the vault
	 *  resumes from the next integer. */
	async nextSeq(sender: Uint8Array, entityId: string): Promise<number> {
		this.assertOpen();
		assertNonEmptyEntityId(entityId);
		const key = pairKey(sender, entityId);
		const current = this.send.get(key) ?? -1;
		const next = current + 1;
		this.send.set(key, next);
		await this.persist();
		return next;
	}

	/** Receiver-side replay check. See class docstring for the three
	 *  return values. State updates persist before returning. */
	async accept(sender: Uint8Array, entityId: string, seq: number): Promise<SeqAcceptance> {
		this.assertOpen();
		assertNonEmptyEntityId(entityId);
		if (!Number.isInteger(seq) || seq < 0) {
			throw new Error(`SeqTracker.accept: seq must be a non-negative integer, got ${seq}`);
		}
		const key = pairKey(sender, entityId);
		const state = this.receive.get(key);
		if (!state) {
			this.receive.set(key, { highest: seq, bitmap: 1n });
			await this.persist();
			return SeqAcceptance.Fresh;
		}
		if (seq > state.highest) {
			const delta = BigInt(seq - state.highest);
			if (delta >= BigInt(this.windowBits)) {
				state.bitmap = 1n;
			} else {
				state.bitmap = ((state.bitmap << delta) & this.windowMask) | 1n;
			}
			state.highest = seq;
			await this.persist();
			return SeqAcceptance.Fresh;
		}
		const offset = state.highest - seq;
		if (offset >= this.windowBits) return SeqAcceptance.OutOfWindow;
		const bit = 1n << BigInt(offset);
		if ((state.bitmap & bit) !== 0n) return SeqAcceptance.Duplicate;
		state.bitmap = (state.bitmap | bit) & this.windowMask;
		await this.persist();
		return SeqAcceptance.Fresh;
	}

	/** Flush any pending writes and mark the tracker disposed. Idempotent. */
	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		await this.writeChain;
	}

	private persist(): Promise<void> {
		const next = this.writeChain.then(() => this.writeToDisk());
		this.writeChain = next.catch(() => undefined);
		return next;
	}

	private async writeToDisk(): Promise<void> {
		const receive: Record<string, SerializedReceive> = {};
		for (const [key, state] of this.receive) {
			receive[key] = { highest: state.highest, bitmapHex: state.bitmap.toString(16) };
		}
		const send: Record<string, number> = {};
		for (const [key, value] of this.send) {
			send[key] = value;
		}
		const file: SerializedFile = { version: FORMAT_VERSION, receive, send };
		await mkdir(dirname(this.filePath), { recursive: true });
		await writeFile(this.filePath, `${JSON.stringify(file)}\n`, "utf8");
	}

	private assertOpen(): void {
		if (this.disposed) throw new Error("SeqTracker is disposed");
	}
}

function pairKey(sender: Uint8Array, entityId: string): string {
	return `${bytesToBase64(sender)}::${entityId}`;
}

function assertNonEmptyEntityId(entityId: string): void {
	if (entityId === "") throw new Error("SeqTracker: entityId must be non-empty");
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code: unknown }).code === "ENOENT"
	);
}
