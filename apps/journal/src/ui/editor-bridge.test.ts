import type { LexicalEditor } from "lexical";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clearJournalEditor,
	hasJournalEditor,
	insertEntityMention,
	setJournalEditor,
} from "./editor-bridge";

/** A fake editor — `update` is a mock that does NOT invoke its callback, so
 *  the bridge's dispatch path is exercised without a real Lexical context. */
function fakeEditor() {
	return { update: vi.fn(), focus: vi.fn() } as unknown as LexicalEditor & {
		update: ReturnType<typeof vi.fn>;
		focus: ReturnType<typeof vi.fn>;
	};
}

afterEach(() => {
	// Reset module capture state between tests via the public clear path.
	const e = fakeEditor();
	setJournalEditor(e);
	clearJournalEditor(e);
});

describe("editor-bridge", () => {
	it("reports no editor + no-ops insert before one is captured", () => {
		expect(hasJournalEditor()).toBe(false);
		expect(insertEntityMention("id", "type", "Label")).toBe(false);
	});

	it("captures an editor and dispatches an update + focus on insert", () => {
		const editor = fakeEditor();
		setJournalEditor(editor);
		expect(hasJournalEditor()).toBe(true);
		expect(insertEntityMention("journal-2026-05-14", "io.brainstorm.journal/Entry/v1", "Thu")).toBe(
			true,
		);
		expect(editor.update).toHaveBeenCalledTimes(1);
		expect(editor.focus).toHaveBeenCalledTimes(1);
	});

	it("clears only the matching editor (cross-day remount safe)", () => {
		const first = fakeEditor();
		const second = fakeEditor();
		setJournalEditor(first);
		setJournalEditor(second);
		// An out-of-order unmount of the OLD editor must not drop the live one.
		clearJournalEditor(first);
		expect(hasJournalEditor()).toBe(true);
		clearJournalEditor(second);
		expect(hasJournalEditor()).toBe(false);
	});
});
