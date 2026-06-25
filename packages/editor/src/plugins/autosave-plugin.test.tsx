// @vitest-environment jsdom
/**
 * AutosavePlugin mount-echo regression. Opening a note remounts the
 * Lexical composer; hydration + the TitlePlugin RootNode transform emit
 * update commits with no user input. Persisting those bumped
 * `StoredNote.updatedAt`, which re-sorted the recency sidebar and pulled
 * the just-clicked note to the top (with a scroll jump).
 *
 * What this proves:
 *   - Commits with no preceding user interaction (mount / settle /
 *     idempotent re-normalization) do NOT call `onChange`.
 *   - The user's first real edit DOES call `onChange` exactly once —
 *     including when the stored body is already canonical and there was
 *     no settle commit at all (the reported bug: editing a note didn't
 *     bump it to most-recent / wasn't persisted).
 */

import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	KEY_DOWN_COMMAND,
	type LexicalEditor,
} from "lexical";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutosavePlugin } from "./autosave-plugin";

function seedParagraph(text: string) {
	return () => {
		const root = $getRoot();
		root.clear();
		root.append($createParagraphNode().append($createTextNode(text)));
	};
}

function CaptureEditor({ onEditor }: { onEditor: (e: LexicalEditor) => void }) {
	const [editor] = useLexicalComposerContext();
	onEditor(editor);
	return null;
}

describe("AutosavePlugin mount echo", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		vi.useFakeTimers();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		vi.useRealTimers();
	});

	const DISCRETE = { discrete: true } as const;

	function mount(onChange: (s: unknown) => void) {
		let editor!: LexicalEditor;
		act(() => {
			root.render(
				<LexicalComposer
					initialConfig={{
						namespace: "test",
						editorState: seedParagraph("hello"),
						onError(e) {
							throw e;
						},
					}}
				>
					<AutosavePlugin onChange={onChange} />
					<CaptureEditor
						onEditor={(e) => {
							editor = e;
						}}
					/>
				</LexicalComposer>,
			);
		});
		return editor;
	}

	function settle(editor: LexicalEditor) {
		// Stand-in for the hydration / TitlePlugin settle commit: a
		// commit with no preceding user interaction.
		act(() => {
			editor.update(() => {
				$getRoot().getFirstChild()?.markDirty();
			}, DISCRETE);
			vi.runAllTimers();
		});
	}

	// A real user edit: a key-down (arms the interaction gate) followed
	// by the resulting content commit. Plain `editor.update` alone is
	// indistinguishable from a programmatic / settle commit and must not
	// persist — only user-originated changes do.
	function userEdit(editor: LexicalEditor, mutate: () => void) {
		act(() => {
			editor.dispatchCommand(KEY_DOWN_COMMAND, new KeyboardEvent("keydown", { key: "a" }));
			editor.update(mutate, DISCRETE);
			vi.runAllTimers();
		});
	}

	it("swallows the mount-settle echo, then emits for a real edit", () => {
		const onChange = vi.fn();
		const editor = mount(onChange);

		settle(editor);
		expect(onChange).not.toHaveBeenCalled();

		userEdit(editor, () => {
			$getRoot().append($createParagraphNode().append($createTextNode("typed")));
		});

		expect(onChange).toHaveBeenCalledTimes(1);
	});

	it("emits for the user's first edit when there was NO mount-settle echo", () => {
		// The reported bug: a note whose stored body is already canonical
		// produces no hydration / TitlePlugin normalization commit, so the
		// very first commit is the user typing. The old "first commit is
		// the baseline" logic adopted+swallowed it — the edit never
		// persisted and the sidebar never re-sorted by recency.
		const onChange = vi.fn();
		const editor = mount(onChange);

		userEdit(editor, () => {
			$getRoot().append($createParagraphNode().append($createTextNode("typed")));
		});

		expect(onChange).toHaveBeenCalledTimes(1);
	});

	it("never emits when only idempotent no-op commits follow the echo", () => {
		const onChange = vi.fn();
		const editor = mount(onChange);

		settle(editor);
		// A second normalization pass that re-serializes identically, with
		// no user interaction — the case that used to bump updatedAt and
		// reorder the sidebar.
		act(() => {
			editor.update(() => {
				$getRoot().getFirstChild()?.markDirty();
			}, DISCRETE);
			vi.runAllTimers();
		});

		expect(onChange).not.toHaveBeenCalled();
	});
});
