/**
 * DictionaryEditorHost — bridges the `dictionaryEditorStore` signal to
 * the `<DictionaryEditor>`: resolves the active dictionary + its bound
 * properties from the vault stores and renders the editor overlay.
 *
 * Mounted automatically by `<PropertiesProvider>`, so EVERY app that
 * exposes dictionary-backed (Tag / Select) properties gets a working
 * "Manage values…" footer — not just Notes. Renders nothing until a Tag
 * cell opens the editor.
 *
 * The host is generic: the consuming app optionally supplies its entity
 * values (for usage badges + delete/merge value rewrites) and a `kv`
 * storage (for the per-user sort-mode preference). Omit them and add /
 * rename / reorder / archive still work — only usage counts read 0 and
 * destructive ops can't rewrite bound values.
 */

import { type JSX, Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { dictionaryEditorStore, useActiveDictionaryEditor } from "./dictionary-editor-store";
import {
	DictionarySortMode,
	dictionarySortPrefKey,
	parseDictionarySortMode,
} from "./dictionary-helpers";
import { type NoteValues, propertiesForDictionary } from "./dictionary-ops";
import { useDictionaryStore, usePropertyStore } from "./use-properties";

// The 490-line editor (+ dictionary-ops / dictionary-import) only mounts
// when a Tag cell's "Manage values" footer opens it; the dynamic import
// keeps it a separate chunk so the eager property-ui load stays lean.
const DictionaryEditor = lazy(() =>
	import("./dictionary-editor").then((m) => ({ default: m.DictionaryEditor })),
);

/** Structural `kv` storage the host needs for sort-mode persistence —
 *  decoupled from any host app's full storage service shape. */
export type DictionarySortStorage = {
	get<T>(key: string): Promise<T | null | undefined>;
	put(key: string, value: unknown): Promise<void>;
};

export type DictionaryEditorHostProps = {
	/** Entity values backing usage badges + delete/merge rewrites. */
	entities?: readonly NoteValues[] | undefined;
	/** Persist the entities whose bound values a delete/merge rewrote. */
	onRewriteEntities?: ((changed: readonly NoteValues[]) => void) | undefined;
	/** `kv` storage for the per-user sort-mode preference. */
	storage?: DictionarySortStorage | undefined;
};

export function DictionaryEditorHost({
	entities,
	onRewriteEntities,
	storage,
}: DictionaryEditorHostProps): JSX.Element | null {
	const activeId = useActiveDictionaryEditor();
	const { store: dictionaryStore, dictionaries } = useDictionaryStore();
	const { properties } = usePropertyStore();
	const [sortMode, setSortMode] = useState<DictionarySortMode>(DictionarySortMode.Manual);

	const dictionary = activeId ? dictionaries.get(activeId) : undefined;

	useEffect(() => {
		if (!activeId || !storage) {
			setSortMode(DictionarySortMode.Manual);
			return;
		}
		let cancelled = false;
		void storage
			.get<string>(dictionarySortPrefKey(activeId))
			.then((raw) => {
				if (!cancelled) setSortMode(parseDictionarySortMode(raw));
			})
			.catch(() => {
				if (!cancelled) setSortMode(DictionarySortMode.Manual);
			});
		return () => {
			cancelled = true;
		};
	}, [activeId, storage]);

	const boundProps = useMemo(
		() => (activeId ? propertiesForDictionary(properties.values(), activeId) : []),
		[properties, activeId],
	);

	const entityValues = useMemo<readonly NoteValues[]>(() => entities ?? [], [entities]);

	const onSortModeChange = useCallback(
		(mode: DictionarySortMode) => {
			setSortMode(mode);
			if (activeId && storage) {
				void storage.put(dictionarySortPrefKey(activeId), mode).catch(() => undefined);
			}
		},
		[activeId, storage],
	);

	const onRewriteNotes = useCallback(
		(changed: readonly NoteValues[]) => {
			onRewriteEntities?.(changed);
		},
		[onRewriteEntities],
	);

	if (!activeId || !dictionary) return null;

	return (
		<div className="notes__dict-overlay">
			<Suspense fallback={null}>
				<DictionaryEditor
					dictionary={dictionary}
					properties={boundProps}
					notes={entityValues}
					sortMode={sortMode}
					onSortModeChange={onSortModeChange}
					onCommit={(next) => dictionaryStore.put(next)}
					onRewriteNotes={onRewriteNotes}
					onClose={() => dictionaryEditorStore.close()}
				/>
			</Suspense>
		</div>
	);
}
