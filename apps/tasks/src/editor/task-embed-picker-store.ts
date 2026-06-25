/**
 * Singleton pub-sub driving the `TaskEmbedPickerPlugin` overlay.
 *
 * Opened by the `/task` slash command in the inspector body editor. The
 * slash command sets the target — the already-cleared paragraph it should
 * replace, plus an anchor rect to position the popover against. The picker
 * plugin listens via `useTaskEmbedPickerTarget()`.
 *
 * Mirrors Notes' `embedPickerStore` (9.4.1) — no React context, a single
 * module-level instance per app renderer (the inspector mounts one editor
 * tree for the app's lifetime).
 */

import type { NodeKey } from "lexical";
import { useSyncExternalStore } from "react";

export type TaskEmbedPickerTarget = {
	paragraphKey: NodeKey;
	/** Bounding rect of the empty paragraph the picker is anchored against.
	 *  The popover positions itself below this rect (flips above when there
	 *  isn't space). */
	anchor: { top: number; left: number; bottom: number };
};

type Listener = () => void;

class TaskEmbedPickerStore {
	private target: TaskEmbedPickerTarget | null = null;
	private listeners = new Set<Listener>();

	getSnapshot = (): TaskEmbedPickerTarget | null => this.target;

	subscribe = (listener: Listener): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	open(target: TaskEmbedPickerTarget): void {
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

export const taskEmbedPickerStore = new TaskEmbedPickerStore();

export function useTaskEmbedPickerTarget(): TaskEmbedPickerTarget | null {
	return useSyncExternalStore(
		taskEmbedPickerStore.subscribe,
		taskEmbedPickerStore.getSnapshot,
		taskEmbedPickerStore.getSnapshot,
	);
}
