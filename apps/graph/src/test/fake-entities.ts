/**
 * In-memory fake of the entities service + Y.Doc replica transport, shared
 * by the repository test suites (`graph-repository.test.ts`,
 * `graph-view-repository.test.ts`). One record store keyed by id; one doc
 * store keyed by id holding the merged Y.Doc bytes. The Y.Doc replica is
 * reconstructed on every `applyDoc` call so the tests mirror the
 * shell-side worker's "snapshot + tail" persistence.
 */

import * as Y from "yjs";
import type { EntitiesDocService, EntitiesService, EntityRecord } from "../storage/runtime";

export function b64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
	return out;
}

export function bytesToB64(bytes: Uint8Array): string {
	let bin = "";
	for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i] ?? 0);
	return btoa(bin);
}

export type FakeEntities = {
	entities: EntitiesService & EntitiesDocService;
	records: Map<string, EntityRecord>;
	docs: Map<string, Uint8Array>;
};

export function makeFakeEntities(): FakeEntities {
	const records = new Map<string, EntityRecord>();
	const docs = new Map<string, Uint8Array>();
	let nextId = 1;

	const entities: EntitiesService & EntitiesDocService = {
		async get(id) {
			return records.get(id) ?? null;
		},
		async query({ type }) {
			const types = type === undefined ? null : Array.isArray(type) ? type : [type];
			return [...records.values()].filter((r) => types === null || types.includes(r.type));
		},
		async create(type, properties, id) {
			const now = Date.now();
			const recordId = id ?? `entity_${nextId++}`;
			const record: EntityRecord = {
				id: recordId,
				type,
				properties: { ...properties },
				createdAt: now,
				updatedAt: now,
			};
			records.set(recordId, record);
			return record;
		},
		async update(id, patch) {
			const existing = records.get(id);
			if (!existing) throw new Error(`update: ${id} not found`);
			const next: EntityRecord = {
				...existing,
				properties: { ...existing.properties, ...patch },
				updatedAt: Date.now(),
			};
			records.set(id, next);
			return next;
		},
		async delete(id) {
			records.delete(id);
			docs.delete(id);
		},
		async loadDoc(id) {
			const bytes = docs.get(id);
			if (!bytes) return { snapshotB64: null };
			return { snapshotB64: bytesToB64(bytes) };
		},
		async applyDoc(id, updateB64) {
			const doc = new Y.Doc();
			const existing = docs.get(id);
			if (existing) Y.applyUpdate(doc, existing);
			Y.applyUpdate(doc, b64ToBytes(updateB64));
			docs.set(id, Y.encodeStateAsUpdate(doc));
		},
		async closeDoc() {
			// no-op in the fake
		},
	};
	return { entities, records, docs };
}
