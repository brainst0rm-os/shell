/**
 * Pure translation of an incoming `intent.open` / `quick-look` payload into
 * the next Preview gallery state. Framework-free so the branch logic is
 * unit-tested without a DOM (the React app just executes the transition).
 *
 * `context`/`siblings` are opt-in: absent, Preview keeps the current gallery
 * and only re-focuses the entity. Resolving a bare entity id to a single
 * file (the fresh-launch handshake shape) needs the capability-gated
 * `entities.get`, injected here as `resolve` so this stays testable.
 */

import type { PreviewFile } from "../demo/dataset";
import { decideOpenAction } from "../logic/open-action";
import { type PreviewContext, PreviewContextKind } from "../types/preview-context";
import type { OpenPayload, PreviewContextSibling } from "./runtime";

/** The next gallery state an open payload resolves to. */
export type GalleryState = {
	context: PreviewContext | null;
	siblings: ReadonlyArray<PreviewFile>;
	focusId: string | null;
};

export function toPreviewFiles(
	siblings: ReadonlyArray<PreviewContextSibling>,
): ReadonlyArray<PreviewFile> {
	const seen = new Set<string>();
	const out: PreviewFile[] = [];
	for (const sib of siblings) {
		if (!sib || typeof sib.id !== "string" || !sib.id) continue;
		if (seen.has(sib.id)) continue;
		seen.add(sib.id);
		const sizeBytes = typeof sib.sizeBytes === "number" ? sib.sizeBytes : null;
		out.push({
			id: sib.id,
			info: {
				name: sib.name,
				mime: sib.mime,
				sizeBytes,
				modifiedAt: typeof sib.modifiedAt === "number" ? sib.modifiedAt : null,
			},
			source: { kind: "url", url: sib.url, mime: sib.mime, sizeBytes },
		});
	}
	return out;
}

function indexOfIdIn(list: ReadonlyArray<PreviewFile>, id: string): number {
	for (let i = 0; i < list.length; i++) {
		if (list[i]?.id === id) return i;
	}
	return -1;
}

/**
 * Resolve an open payload to the next gallery state, or `null` for a no-op.
 * `current` is the gallery already on screen (so a bare focus can short-
 * circuit when the entity is present); `resolve` turns a bare entity id into
 * a single renderable file.
 */
export async function resolveOpenPayload(
	payload: OpenPayload,
	current: ReadonlyArray<PreviewFile>,
	resolve: (entityId: string) => Promise<PreviewFile | null>,
): Promise<GalleryState | null> {
	const action = decideOpenAction(payload);
	if (action.kind === "none") return null;

	const inline = payload.siblings;
	const siblings = inline && inline.length > 0 ? toPreviewFiles(inline) : null;

	if (action.kind === "focus") {
		if (indexOfIdIn(current, action.entityId) >= 0) {
			return { context: null, siblings: current, focusId: action.entityId };
		}
		const file = await resolve(action.entityId);
		if (!file) return null;
		return { context: { kind: PreviewContextKind.Single }, siblings: [file], focusId: file.id };
	}

	// `context` kind: an enriched dispatch.
	if (siblings) {
		return {
			context: payload.context ?? null,
			siblings,
			focusId: action.entityId ?? null,
		};
	}
	if (action.entityId) {
		const file = await resolve(action.entityId);
		if (file) {
			return {
				context: payload.context ?? { kind: PreviewContextKind.Single },
				siblings: [file],
				focusId: file.id,
			};
		}
	}
	return { context: payload.context ?? null, siblings: [], focusId: action.entityId ?? null };
}
