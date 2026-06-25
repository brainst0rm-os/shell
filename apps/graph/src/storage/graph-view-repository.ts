/**
 * `GraphView/v1` repository over the shared entities service (9.13.6).
 *
 * A GraphView is a *rendering* of a Graph — per the resolved OQ-GR-2 it
 * owns the layout coordinates (a `coords` Y.Map keyed by node entity-id,
 * see `logic/graph-view-yjs-codec.ts`); the property bag carries the view
 * metadata (`graphId`, `name`, `kind`, layout/visibility/settings/history
 * defaults per `docs/apps/graph/01-data-model.md`).
 *
 * v1 surface: one default view per Graph (`ensureDefaultView`), coordinate
 * load/save through the Y.Doc transport. The multi-view lifecycle (view
 * tabs, duplicate, per-view settings editing) is forward scope — this
 * repository is the storage seam it will grow on.
 *
 * Errors are caught + logged; a failed load degrades to "no restored
 * coordinates" (the force layout re-seeds), mirroring `graph-repository`.
 */

import * as Y from "yjs";
import {
	type NodeCoord,
	decodeCoordsFromDoc,
	encodeCoordsIntoDoc,
} from "../logic/graph-view-yjs-codec";
import {
	CameraPolicy,
	GraphViewKind,
	HistoryReveal,
	LayoutKind,
	NodeColoring,
	NodeSizing,
	SortDirection,
} from "../types/graph-view";
import type { EntitiesDocService, EntitiesService, EntityRecord } from "./runtime";

export const GRAPH_VIEW_TYPE = "brainstorm/GraphView/v1";

export type GraphViewRecord = {
	id: string;
	graphId: string;
	name: string;
	createdAt: number;
	updatedAt: number;
};

export type GraphViewRepository = {
	listViews(graphId: string): Promise<GraphViewRecord[]>;
	/** The first (oldest) view bound to `graphId`, creating it when the
	 *  Graph has none yet. Returns null only when the create itself fails. */
	ensureDefaultView(graphId: string, name: string): Promise<GraphViewRecord | null>;
	loadViewCoords(viewId: string): Promise<Map<string, NodeCoord>>;
	saveViewCoords(viewId: string, coords: ReadonlyMap<string, NodeCoord>): Promise<void>;
	closeView(viewId: string): Promise<void>;
};

/** The full default property bag for a fresh view (manifest schema shape —
 *  `kind`/`layoutOptions`/`visibility`/`settings`/`history`/`ordering` are
 *  required fields). */
export function defaultGraphViewProperties(
	graphId: string,
	name: string,
	now: number = Date.now(),
): Record<string, unknown> {
	return {
		graphId,
		name,
		kind: GraphViewKind.Full,
		layoutOptions: {
			kind: GraphViewKind.Full,
			layout: LayoutKind.Force,
			forceParams: null,
			initialCenter: null,
		},
		visibility: {
			showLabels: true,
			showIcons: true,
			showArrows: true,
			showOrphans: true,
			showPreviewOnHover: true,
			clusterByType: false,
			hiddenTypes: [],
			hiddenLinkTypes: [],
		},
		filterOverlay: null,
		ordering: {
			primary: { key: "created", direction: SortDirection.Asc },
			secondary: null,
		},
		settings: {
			sizing: NodeSizing.ByDegree,
			nodeSizeProperty: null,
			coloring: NodeColoring.ByType,
			nodeColorProperty: null,
			showTypeEdges: false,
			edgeOpacity: 1,
			webgl: true,
			highQuality: true,
			linkTypeOverrides: {},
		},
		history: {
			enabled: false,
			startAt: null,
			endAt: null,
			cutoffAt: null,
			speed: 1,
			reveal: HistoryReveal.Eased,
		},
		cameraPolicy: CameraPolicy.Keep,
		system: false,
		createdAt: now,
		updatedAt: now,
	};
}

function logError(op: string, err: unknown): void {
	console.error(`[graph/view-repository] ${op} failed:`, err);
}

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

function recordToView(record: EntityRecord): GraphViewRecord | null {
	const props = record.properties ?? {};
	const graphId = typeof props.graphId === "string" ? props.graphId : null;
	if (!graphId) return null;
	return {
		id: record.id,
		graphId,
		name: typeof props.name === "string" ? props.name : "",
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

export function createGraphViewRepository(
	entities: EntitiesService & Partial<EntitiesDocService>,
): GraphViewRepository {
	async function listViews(graphId: string): Promise<GraphViewRecord[]> {
		try {
			const records = await entities.query({ type: GRAPH_VIEW_TYPE });
			return records
				.map(recordToView)
				.filter((v): v is GraphViewRecord => v !== null && v.graphId === graphId)
				.sort((a, b) => a.createdAt - b.createdAt);
		} catch (err) {
			logError("listViews", err);
			return [];
		}
	}

	return {
		listViews,

		async ensureDefaultView(graphId, name) {
			const existing = await listViews(graphId);
			const first = existing[0];
			if (first) return first;
			try {
				const record = await entities.create(
					GRAPH_VIEW_TYPE,
					defaultGraphViewProperties(graphId, name),
				);
				return recordToView(record);
			} catch (err) {
				logError("ensureDefaultView:create", err);
				return null;
			}
		},

		async loadViewCoords(viewId) {
			if (!entities.loadDoc) return new Map();
			try {
				const { snapshotB64 } = await entities.loadDoc(viewId);
				const doc = new Y.Doc();
				if (snapshotB64) Y.applyUpdate(doc, b64ToBytes(snapshotB64));
				return decodeCoordsFromDoc(doc);
			} catch (err) {
				logError("loadViewCoords", err);
				return new Map();
			}
		},

		async saveViewCoords(viewId, coords) {
			if (entities.loadDoc && entities.applyDoc) {
				try {
					// Merge with the current doc state so concurrent writers (another
					// window dragging a different node) converge instead of clobbering.
					const { snapshotB64 } = await entities.loadDoc(viewId);
					const doc = new Y.Doc();
					if (snapshotB64) Y.applyUpdate(doc, b64ToBytes(snapshotB64));
					const before = Y.encodeStateVector(doc);
					encodeCoordsIntoDoc(doc, coords);
					const update = Y.encodeStateAsUpdate(doc, before);
					if (update.length > 0) {
						await entities.applyDoc(viewId, bytesToB64(update));
					}
				} catch (err) {
					logError("saveViewCoords:applyDoc", err);
				}
			}
			try {
				await entities.update(viewId, { updatedAt: Date.now() });
			} catch (err) {
				logError("saveViewCoords:update", err);
			}
		},

		async closeView(viewId) {
			if (!entities.closeDoc) return;
			try {
				await entities.closeDoc(viewId);
			} catch (err) {
				logError("closeView", err);
			}
		},
	};
}
