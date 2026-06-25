/**
 * Tiny external store carrying "which dictionary the full editor is
 * open against". The Tag cells' "Manage values" footer (B5.7) sets a
 * dictionary id; the `DictionaryEditorHost` (B5.8) subscribes and
 * renders the editor overlay. Mirrors `addPropertyStore`'s shape.
 */

import { useSyncExternalStore } from "react";

type Listener = () => void;

class DictionaryEditorStore {
	private activeId: string | null = null;
	private readonly listeners = new Set<Listener>();

	open(dictionaryId: string): void {
		if (this.activeId === dictionaryId) return;
		this.activeId = dictionaryId;
		this.emit();
	}

	close(): void {
		if (this.activeId === null) return;
		this.activeId = null;
		this.emit();
	}

	getActive(): string | null {
		return this.activeId;
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private emit(): void {
		for (const l of this.listeners) l();
	}
}

export const dictionaryEditorStore = new DictionaryEditorStore();

export function useActiveDictionaryEditor(): string | null {
	return useSyncExternalStore(
		(listener) => dictionaryEditorStore.subscribe(listener),
		() => dictionaryEditorStore.getActive(),
	);
}
