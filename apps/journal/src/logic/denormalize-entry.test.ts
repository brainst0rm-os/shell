import type { SerializedEditorState } from "lexical";
import { describe, expect, it, vi } from "vitest";
import { buildJournalDenormalizer } from "./denormalize-entry";

const ROOT_BASE = {
	type: "root" as const,
	version: 1,
	format: "",
	indent: 0,
	direction: null,
};

function body(...children: unknown[]): SerializedEditorState {
	return { root: { ...ROOT_BASE, children } } as unknown as SerializedEditorState;
}

describe("buildJournalDenormalizer", () => {
	it("patches the entity's body snippet for the bound note id", () => {
		const update = vi.fn();
		const onChange = buildJournalDenormalizer(update, "journal-2026-06-01");
		onChange(body({ type: "paragraph", children: [{ type: "text", text: "wrote some things" }] }));
		expect(update).toHaveBeenCalledTimes(1);
		expect(update).toHaveBeenCalledWith("journal-2026-06-01", {
			body: "wrote some things",
			wordCount: 3,
		});
	});

	it("never writes title — a Journal entry is identified by its ISO-date title", () => {
		const update = vi.fn();
		const onChange = buildJournalDenormalizer(update, "journal-2026-06-01");
		// A body heading would parse as a TitleNode; it must NOT overwrite the
		// entity title (that would drop the entry from `projectJournalEntries`).
		onChange(
			body(
				{ type: "title", children: [{ type: "text", text: "My great day" }] },
				{ type: "paragraph", children: [{ type: "text", text: "body text" }] },
			),
		);
		const [, patch] = update.mock.calls[0] as [string, Record<string, unknown>];
		expect(patch).not.toHaveProperty("title");
		expect(patch).toEqual({ body: "My great day body text", wordCount: 5 });
	});

	it("writes an empty snippet when the body is cleared (so the preview clears too)", () => {
		const update = vi.fn();
		const onChange = buildJournalDenormalizer(update, "journal-2026-06-01");
		onChange(body({ type: "paragraph", children: [] }));
		expect(update).toHaveBeenCalledWith("journal-2026-06-01", { body: "", wordCount: 0 });
	});

	it("surfaces the computed snippet + word count to onComputed (live readout path)", () => {
		const update = vi.fn();
		const onComputed = vi.fn();
		const onChange = buildJournalDenormalizer(update, "journal-2026-06-01", onComputed);
		onChange(body({ type: "paragraph", children: [{ type: "text", text: "two words" }] }));
		expect(onComputed).toHaveBeenCalledTimes(1);
		expect(onComputed).toHaveBeenCalledWith({ snippet: "two words", wordCount: 2 });
	});
});
