import { createHeadlessEditor } from "@lexical/headless";
import { $createParagraphNode, $createTextNode, $getRoot } from "lexical";
import { describe, expect, it } from "vitest";
import {
	TYPING_SHORTCUTS,
	UNICODE_SHORTCUT_TRANSFORMERS,
	rewriteTrailingShortcut,
} from "./typing-shortcuts";

describe("rewriteTrailingShortcut (pure)", () => {
	it("rewrites each documented shortcut at the end of the text", () => {
		for (const { ascii, glyph } of TYPING_SHORTCUTS) {
			const r = rewriteTrailingShortcut(`see ${ascii}`);
			expect(r, ascii).not.toBeNull();
			expect(r?.text).toBe(`see ${glyph}`);
			expect(r?.shortcut.ascii).toBe(ascii);
		}
	});

	it("returns null when the text doesn't end with a shortcut", () => {
		expect(rewriteTrailingShortcut("plain text")).toBeNull();
		expect(rewriteTrailingShortcut("-> already converted →")).toBeNull();
		// A shortcut not at the end doesn't fire (the trigger is the last char).
		expect(rewriteTrailingShortcut("-> tail")).toBeNull();
	});

	it("replaces only the trailing run, preserving the prefix", () => {
		expect(rewriteTrailingShortcut("a--b...")?.text).toBe("a--b…");
	});

	it("has a unique glyph per ascii run and no empty fields", () => {
		const asciis = new Set(TYPING_SHORTCUTS.map((s) => s.ascii));
		expect(asciis.size).toBe(TYPING_SHORTCUTS.length);
		for (const s of TYPING_SHORTCUTS) {
			expect(s.ascii.length).toBeGreaterThan(0);
			expect(s.glyph.length).toBeGreaterThan(0);
		}
	});
});

describe("UNICODE_SHORTCUT_TRANSFORMERS", () => {
	it("emits one text-match transformer per shortcut, triggered by its last char", () => {
		expect(UNICODE_SHORTCUT_TRANSFORMERS).toHaveLength(TYPING_SHORTCUTS.length);
		UNICODE_SHORTCUT_TRANSFORMERS.forEach((t, i) => {
			const s = TYPING_SHORTCUTS[i];
			expect(t.type).toBe("text-match");
			expect(t.trigger).toBe(s?.ascii.at(-1));
			expect(t.regExp.test(`x${s?.ascii}`)).toBe(true);
			expect(t.regExp.test(`${s?.ascii}x`)).toBe(false); // anchored at end
		});
	});

	// Drive each transformer's own `replace` against a real (headless) text
	// node + the match its `regExp` produces — deterministic proof the splice
	// lands the glyph in place (the markdown plugin's keystroke timing is the
	// separate real-shell concern, not tested here).
	it("each transformer's replace splices the trailing run for its glyph", () => {
		const editor = createHeadlessEditor({
			namespace: "ts-test",
			nodes: [],
			onError: (e) => {
				throw e;
			},
		});
		UNICODE_SHORTCUT_TRANSFORMERS.forEach((transformer, i) => {
			const { ascii, glyph } = TYPING_SHORTCUTS[i] as (typeof TYPING_SHORTCUTS)[number];
			const before = `x ${ascii}`;
			const match = before.match(transformer.regExp);
			expect(match, ascii).not.toBeNull();
			editor.update(
				() => {
					$getRoot().clear();
					const p = $createParagraphNode();
					p.append($createTextNode(before));
					$getRoot().append(p);
				},
				{ discrete: true },
			);
			editor.update(
				() => {
					const node = $getRoot().getAllTextNodes()[0];
					if (node && match) transformer.replace?.(node, match);
				},
				{ discrete: true },
			);
			const out = editor.getEditorState().read(() => $getRoot().getTextContent());
			expect(out, ascii).toBe(`x ${glyph}`);
		});
	});
});
