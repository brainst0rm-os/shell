/**
 * Vanilla pub-sub store that the image/video views write to when the
 * user clicks them, and the `MediaInspectorPlugin` subscribes to. Same
 * pattern as `BlockSelectionStore` — no context, no React deps, hook
 * via `useSyncExternalStore`.
 */

import type { NodeKey } from "lexical";
import { useSyncExternalStore } from "react";

export enum MediaKind {
	Image = "image",
	Video = "video",
}

export type InspectorTarget = {
	nodeKey: NodeKey;
	kind: MediaKind;
	/** Viewport-relative rect of the clicked figure — anchor for the popover. */
	anchor: DOMRect;
};

type Listener = () => void;

class MediaInspectorStore {
	private target: InspectorTarget | null = null;
	private listeners = new Set<Listener>();

	getSnapshot = (): InspectorTarget | null => this.target;

	subscribe = (listener: Listener): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	open(target: InspectorTarget): void {
		this.target = target;
		this.emit();
	}

	close(): void {
		if (this.target === null) return;
		this.target = null;
		this.emit();
	}

	/** Re-anchor without changing the targeted node — used when the
	 *  caller wants to keep the inspector open after a node mutation
	 *  (e.g. alignment change reflows the figure). */
	reanchor(anchor: DOMRect): void {
		if (!this.target) return;
		this.target = { ...this.target, anchor };
		this.emit();
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}
}

export const mediaInspectorStore = new MediaInspectorStore();

export function useMediaInspector(): InspectorTarget | null {
	return useSyncExternalStore(
		mediaInspectorStore.subscribe,
		mediaInspectorStore.getSnapshot,
		mediaInspectorStore.getSnapshot,
	);
}
