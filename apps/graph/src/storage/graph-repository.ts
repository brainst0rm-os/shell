/**
 * `Graph/v1` repository over the shared entities service (9.13.2).
 *
 * Responsibilities:
 *   - `loadGraph(id)` — fetch the `Graph/v1` entity by id, load its Y.Doc
 *     replica, decode the pattern through the OQ-GR-1 codec, and return
 *     the metadata (name/description/timestamps) + the decoded pattern.
 *   - `saveGraphPattern(id, pattern)` — encode the pattern into a fresh
 *     Y.Doc, ship the update through `entities.applyDoc`, and bump the
 *     entity's `updatedAt` via `entities.update`.
 *   - `createGraph(name, pattern)` — mint a new `Graph/v1` entity (the
 *     properties carry the metadata; the pattern lives in the Y.Doc).
 *   - `closeGraph(id)` — release the worker-side replica.
 *
 * Errors are caught + logged; callers should fall back to the editable
 * default pattern when a load fails (the in-memory pattern is the
 * user-visible truth, mirroring tasks/journal's pattern).
 *
 * Boundaries: this module owns the Y.Doc encode/decode + the IPC envelope
 * shape. The renderer (`app.ts`) never touches Y.Doc directly — it gets
 * a flat `GraphPattern` in, hands a flat `GraphPattern` out. That's the
 * 9.13.2 wiring; 9.13.6 swaps in per-view coordinate persistence on the
 * same envelope without churning the renderer.
 */

import * as Y from "yjs";
import { decodePatternFromDoc, encodePatternIntoDoc } from "../logic/graph-yjs-codec";
import type { GraphPattern } from "../types/pattern";
import type { EntitiesDocService, EntitiesService, EntityRecord } from "./runtime";

export const GRAPH_TYPE = "brainstorm/Graph/v1";

/** A `Graph/v1` entity as the renderer consumes it — the property metadata
 *  separate from the decoded pattern. The Y.Doc round-trip is fully
 *  hidden inside the repository. */
export type GraphRecord = {
	id: string;
	name: string;
	description: string;
	createdAt: number;
	updatedAt: number;
	pattern: GraphPattern;
};

export type GraphRepository = {
	listGraphs(): Promise<EntityRecord[]>;
	loadGraph(id: string): Promise<GraphRecord | null>;
	createGraph(input: {
		name: string;
		description?: string;
		pattern: GraphPattern;
	}): Promise<GraphRecord>;
	saveGraphPattern(id: string, pattern: GraphPattern): Promise<void>;
	renameGraph(id: string, name: string): Promise<void>;
	closeGraph(id: string): Promise<void>;
};

function logError(op: string, err: unknown): void {
	console.error(`[graph/repository] ${op} failed:`, err);
}

/** Decode a base64 string to a Uint8Array. Mirrors the Notes / Journal
 *  resolver — same wire format the entities service uses. */
function b64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
	return out;
}

function bytesToB64(bytes: Uint8Array): string {
	let bin = "";
	const CHUNK = 0x8000;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(bin);
}

/** Read a `Graph/v1` entity's property bag into the renderer-facing
 *  metadata fields. The property bag is the canonical source for
 *  user-visible name/description; the Y.Doc carries only the pattern
 *  (where structural CRDT merge actually pays off — OQ-GR-1). */
function recordToMeta(record: EntityRecord): Omit<GraphRecord, "pattern"> {
	const props = record.properties ?? {};
	const name = typeof props.name === "string" ? props.name : "Untitled graph";
	const description = typeof props.description === "string" ? props.description : "";
	return {
		id: record.id,
		name,
		description,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

export function createGraphRepository(
	entities: EntitiesService & Partial<EntitiesDocService>,
): GraphRepository {
	return {
		async listGraphs() {
			try {
				return await entities.query({ type: GRAPH_TYPE });
			} catch (err) {
				logError("listGraphs", err);
				return [];
			}
		},

		async loadGraph(id) {
			let record: EntityRecord | null;
			try {
				record = await entities.get(id);
			} catch (err) {
				logError("loadGraph:get", err);
				return null;
			}
			if (!record || record.type !== GRAPH_TYPE) return null;

			const meta = recordToMeta(record);
			const doc = new Y.Doc();
			if (entities.loadDoc) {
				try {
					const { snapshotB64 } = await entities.loadDoc(id);
					if (snapshotB64) {
						Y.applyUpdate(doc, b64ToBytes(snapshotB64));
					}
				} catch (err) {
					logError("loadGraph:loadDoc", err);
				}
			}
			const pattern = decodePatternFromDoc(doc);
			return { ...meta, pattern };
		},

		async createGraph({ name, description = "", pattern }) {
			const now = Date.now();
			let record: EntityRecord;
			try {
				record = await entities.create(GRAPH_TYPE, {
					name,
					description,
					createdAt: now,
					updatedAt: now,
				});
			} catch (err) {
				logError("createGraph:create", err);
				throw err;
			}
			// Write the pattern body into the doc and ship it as one update so
			// the persisted snapshot starts in a consistent state.
			if (entities.loadDoc && entities.applyDoc) {
				try {
					await entities.loadDoc(record.id); // primes the worker-side replica
					const doc = new Y.Doc();
					encodePatternIntoDoc(doc, pattern);
					const updateB64 = bytesToB64(Y.encodeStateAsUpdate(doc));
					await entities.applyDoc(record.id, updateB64);
				} catch (err) {
					logError("createGraph:applyDoc", err);
				}
			}
			const meta = recordToMeta(record);
			return { ...meta, pattern };
		},

		async saveGraphPattern(id, pattern) {
			if (entities.loadDoc && entities.applyDoc) {
				try {
					// Read the current doc state first so the new update merges
					// with whatever's already there (concurrent edits, etc.).
					// `encodePatternIntoDoc` itself replaces stale fields atomically
					// inside one transact — the update we ship is the diff.
					const { snapshotB64 } = await entities.loadDoc(id);
					const doc = new Y.Doc();
					if (snapshotB64) Y.applyUpdate(doc, b64ToBytes(snapshotB64));
					const before = Y.encodeStateVector(doc);
					encodePatternIntoDoc(doc, pattern);
					const update = Y.encodeStateAsUpdate(doc, before);
					if (update.length > 0) {
						await entities.applyDoc(id, bytesToB64(update));
					}
				} catch (err) {
					logError("saveGraphPattern:applyDoc", err);
				}
			}
			try {
				await entities.update(id, { updatedAt: Date.now() });
			} catch (err) {
				logError("saveGraphPattern:update", err);
			}
		},

		async renameGraph(id, name) {
			try {
				await entities.update(id, { name, updatedAt: Date.now() });
			} catch (err) {
				logError("renameGraph", err);
			}
		},

		async closeGraph(id) {
			if (!entities.closeDoc) return;
			try {
				await entities.closeDoc(id);
			} catch (err) {
				logError("closeGraph", err);
			}
		},
	};
}
