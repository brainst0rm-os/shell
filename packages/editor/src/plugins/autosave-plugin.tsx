/**
 * AutosavePlugin — debounced serialization of the editor state into a
 * caller-provided sink. Caller is responsible for persistence (the
 * `use-notes` hook already debounces storage.put on top of this, so the
 * effective save latency is ~600ms after the last keystroke).
 *
 * Mount echo: hydrating the composer (parse of the stored body) plus the
 * TitlePlugin RootNode transform produce update commits with no user
 * input. Persisting those bumped `StoredNote.updatedAt`, which re-sorted
 * the recency sidebar and yanked the just-opened note to the top.
 *
 * The discriminator is **real user interaction**, not commit order or
 * serialized-state diffing. The serialized state can't separate the
 * settle echo from an edit on the first commit (Lexical normalizes the
 * parsed body only on the first commit, so its `prevEditorState` is the
 * raw parse and any first commit differs by normalization noise alone),
 * and the earlier "first non-hydrate commit is the baseline" rule
 * adopted-and-swallowed the user's first edit whenever the stored body
 * was already canonical and emitted no settle commit (the reported bug:
 * editing a note didn't bump its recency / wasn't persisted). Instead we
 * arm on the first user-origin command (key down / paste / cut / drop):
 * commits before any interaction are mount / hydration / TitlePlugin
 * settle and update the baseline silently; once the user has acted, a
 * commit whose serialized state diverges from the baseline is emitted.
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
	COMMAND_PRIORITY_LOW,
	CUT_COMMAND,
	DROP_COMMAND,
	KEY_DOWN_COMMAND,
	PASTE_COMMAND,
	type SerializedEditorState,
} from "lexical";
import { useEffect, useRef } from "react";

export type AutosavePluginProps = {
	onChange: (state: SerializedEditorState) => void;
	debounceMs?: number;
};

export function AutosavePlugin({ onChange, debounceMs = 200 }: AutosavePluginProps) {
	const [editor] = useLexicalComposerContext();
	const handleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Serialized snapshot of the last state we consider "saved", and
	// whether the user has actually interacted yet. Until they have,
	// every commit is a mount / hydration / settle echo: it advances the
	// baseline but is never persisted (opening must not bump recency).
	const savedJsonRef = useRef<string | null>(null);
	const userTouchedRef = useRef(false);
	useEffect(() => {
		const markTouched = () => {
			userTouchedRef.current = true;
			return false; // never consume — pass through to the editor
		};
		const unregister = [
			editor.registerCommand(KEY_DOWN_COMMAND, markTouched, COMMAND_PRIORITY_LOW),
			editor.registerCommand(PASTE_COMMAND, markTouched, COMMAND_PRIORITY_LOW),
			editor.registerCommand(CUT_COMMAND, markTouched, COMMAND_PRIORITY_LOW),
			editor.registerCommand(DROP_COMMAND, markTouched, COMMAND_PRIORITY_LOW),
			editor.registerUpdateListener(({ tags }) => {
				if (tags.has("hydrate")) return;
				// Pre-touch (mount / hydration / TitlePlugin settle): no save,
				// no work. The first real user keystroke flips
				// `userTouchedRef` (via the KEY_DOWN/PASTE/CUT/DROP commands
				// above); from that point on every update reschedules the
				// debounce. `savedJsonRef === null` until the first persist
				// fires — the no-op-write guard then compares against it.
				if (!userTouchedRef.current) return;
				// Skip work on the hot path. `toJSON()` + `JSON.stringify()`
				// over a large seeded doc is O(doc size) — doing it per
				// keystroke is what's typing-lag for any non-trivial body
				// even though the persist itself is debounced. Defer both
				// to the debounce trailing edge so the cost is paid once
				// per typing pause, not once per keystroke.
				if (handleRef.current) clearTimeout(handleRef.current);
				handleRef.current = setTimeout(() => {
					handleRef.current = null;
					const serialized = editor.getEditorState().toJSON();
					const json = JSON.stringify(serialized);
					// No-op-write guard: undo/redo back to the saved state
					// shouldn't bump recency or re-encrypt the on-disk row.
					if (json === savedJsonRef.current) return;
					savedJsonRef.current = json;
					onChange(serialized);
				}, debounceMs);
			}),
		];
		return () => {
			for (const off of unregister) off();
		};
	}, [editor, onChange, debounceMs]);
	useEffect(
		() => () => {
			if (handleRef.current) clearTimeout(handleRef.current);
		},
		[],
	);
	return null;
}
