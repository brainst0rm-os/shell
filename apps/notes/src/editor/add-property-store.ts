/**
 * Singleton pub-sub store driving the AddPropertyMenu overlay.
 *
 * Four callers open the picker:
 *   - The `/property` slash command — wants to *replace* the current
 *     empty paragraph with a new `PropertyBlockNode`.
 *   - The block-action menu / right-click "Add property" entry — wants
 *     to *insert* a new `PropertyBlockNode` after the targeted block.
 *   - The "+ Add property" affordance inside a `PropertyListBlockNode`
 *     — wants to *append* a key to that list's `__propertyKeys`.
 *   - The right-hand Properties panel's "Add property" button — wants
 *     to *bind* the picked key onto the open note's value bag (no
 *     editor mutation; the panel surfaces it as an editable row).
 *
 * All three converge on the same `AddPropertyMenu` UI; only the commit
 * handler differs. The discriminated `AddPropertyTarget` union encodes
 * which path the menu should take on selection.
 *
 * Same shape as `mediaInspectorStore` — no context, no React deps;
 * consumers hook in via `useSyncExternalStore` from
 * `useAddPropertyTarget()`.
 */

import type { NodeKey } from "lexical";
import { useSyncExternalStore } from "react";

export enum AddPropertyTargetKind {
	ReplaceParagraph = "replace-paragraph",
	InsertAfter = "insert-after",
	AppendToList = "append-to-list",
	BindToNote = "bind-to-note",
}

export type AddPropertyTarget =
	| {
			kind: AddPropertyTargetKind.ReplaceParagraph;
			/** Key of the empty paragraph the picker should replace with a
			 *  `PropertyBlockNode`. Source: `/property` slash command. */
			paragraphKey: NodeKey;
			anchor: DOMRect;
	  }
	| {
			kind: AddPropertyTargetKind.InsertAfter;
			/** Key of the block the new `PropertyBlockNode` should land after.
			 *  Source: gutter / right-click "Add property". */
			blockKey: NodeKey;
			anchor: DOMRect;
	  }
	| {
			kind: AddPropertyTargetKind.AppendToList;
			/** Key of the `PropertyListBlockNode` to append the picked
			 *  property key into. Source: PropertyList's "+" affordance. */
			listKey: NodeKey;
			anchor: DOMRect;
	  }
	| {
			kind: AddPropertyTargetKind.BindToNote;
			/** Invoked with the picked (or freshly-created) property key.
			 *  The Properties panel binds it onto the open note's value
			 *  bag so it surfaces as an editable row. No editor mutation —
			 *  this path never touches the Lexical tree. */
			onPick: (propertyKey: string) => void;
			anchor: DOMRect;
	  };

type Listener = () => void;

class AddPropertyStore {
	private target: AddPropertyTarget | null = null;
	private listeners = new Set<Listener>();

	getSnapshot = (): AddPropertyTarget | null => this.target;

	subscribe = (listener: Listener): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	open(target: AddPropertyTarget): void {
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

export const addPropertyStore = new AddPropertyStore();

export function useAddPropertyTarget(): AddPropertyTarget | null {
	return useSyncExternalStore(
		addPropertyStore.subscribe,
		addPropertyStore.getSnapshot,
		addPropertyStore.getSnapshot,
	);
}
