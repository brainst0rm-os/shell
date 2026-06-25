/**
 * Singleton pub-sub driving the `BlockEmbedPickerPlugin` overlay.
 *
 * Opened by the `/embed` slash command (and, later, the block-action menu
 * "Insert embed" entry). The slash plugin sets the target — the
 * already-cleared paragraph it should replace, plus an anchor rect to
 * position the popover against. The picker plugin listens via
 * `useEmbedPickerTarget()`.
 *
 * Same shape as `addPropertyStore` / `mediaInspectorStore` — no React
 * context, no module-level singletons leaking between editor instances
 * (the picker plugin remounts with the editor on noteId change).
 */

import type { NodeKey } from "lexical";
import { useSyncExternalStore } from "react";

export type EmbedPickerTarget = {
	paragraphKey: NodeKey;
	/** Bounding rect of the empty paragraph the picker is anchored
	 *  against. The popover positions itself below this rect (flips
	 *  above when there isn't space). */
	anchor: { top: number; left: number; bottom: number };
	/** Scope the picker to one entity type — the type-scoped slash commands
	 *  (`/database` → `brainstorm/List/v1`, `/graph` → `brainstorm/Graph/v1`)
	 *  reuse the generic `/embed` picker with a narrowed list. Absent →
	 *  every entity. */
	typeFilter?: string;
};

type Listener = () => void;

class EmbedPickerStore {
	private target: EmbedPickerTarget | null = null;
	private listeners = new Set<Listener>();

	getSnapshot = (): EmbedPickerTarget | null => this.target;

	subscribe = (listener: Listener): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	open(target: EmbedPickerTarget): void {
		this.target = target;
		this.emit();
	}

	close(): void {
		if (this.target === null) return;
		this.target = null;
		this.emit();
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}
}

export const embedPickerStore = new EmbedPickerStore();

export function useEmbedPickerTarget(): EmbedPickerTarget | null {
	return useSyncExternalStore(
		embedPickerStore.subscribe,
		embedPickerStore.getSnapshot,
		embedPickerStore.getSnapshot,
	);
}
