// @vitest-environment jsdom
import { createHeadlessEditor } from "@lexical/headless";
import {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	$getSelection,
	$isRangeSelection,
	type LexicalEditor,
} from "lexical";
import { beforeEach, describe, expect, it } from "vitest";
import {
	ColorTarget,
	SWATCH_COLORS,
	SwatchColor,
	applySwatch,
	applySwatchToBlocks,
	mergeStyleProp,
	readActiveSwatch,
	swatchCssValue,
	swatchFromCss,
} from "./text-color";

function makeEditor(): LexicalEditor {
	const editor = createHeadlessEditor({
		namespace: "t",
		onError: (e) => {
			throw e;
		},
	});
	editor.update(
		() => {
			const p = $createParagraphNode();
			const text = $createTextNode("hello");
			p.append(text);
			$getRoot().append(p);
			text.select(0, 5);
		},
		{ discrete: true },
	);
	return editor;
}

/** `applySwatch` uses a non-discrete `editor.update` (correct for the
 *  real renderer). The headless editor defers those, so flush with a
 *  discrete no-op before asserting on serialized state. */
function flush(editor: LexicalEditor): void {
	editor.update(() => {}, { discrete: true });
}

function styleOfFirstText(editor: LexicalEditor): string {
	const root = editor.getEditorState().toJSON().root as {
		children: Array<{ children?: Array<{ style?: string }> }>;
	};
	return root.children[0]?.children?.[0]?.style ?? "";
}

describe("swatchCssValue / swatchFromCss", () => {
	it("Default has no CSS value", () => {
		expect(swatchCssValue(ColorTarget.Text, SwatchColor.Default)).toBeNull();
		expect(swatchCssValue(ColorTarget.Highlight, SwatchColor.Default)).toBeNull();
	});

	it("every hued swatch round-trips through css for both targets", () => {
		for (const target of [ColorTarget.Text, ColorTarget.Highlight]) {
			for (const color of SWATCH_COLORS) {
				if (color === SwatchColor.Default) continue;
				const css = swatchCssValue(target, color);
				expect(css).not.toBeNull();
				expect(css).toContain(
					`--notes-swatch-${target === ColorTarget.Text ? "text" : "highlight"}-${color}`,
				);
				expect(swatchFromCss(target, css as string)).toBe(color);
			}
		}
	});

	it("unknown / empty css resolves to Default", () => {
		expect(swatchFromCss(ColorTarget.Text, "")).toBe(SwatchColor.Default);
		expect(swatchFromCss(ColorTarget.Text, "rgb(1,2,3)")).toBe(SwatchColor.Default);
		// A text value must not match a highlight lookup.
		expect(
			swatchFromCss(
				ColorTarget.Highlight,
				swatchCssValue(ColorTarget.Text, SwatchColor.Red) as string,
			),
		).toBe(SwatchColor.Default);
	});
});

describe("applySwatch + readActiveSwatch round-trip", () => {
	let editor: LexicalEditor;
	beforeEach(() => {
		editor = makeEditor();
	});

	it("applies a text colour that serialises into the node style", () => {
		applySwatch(editor, ColorTarget.Text, SwatchColor.Red);
		flush(editor);
		expect(styleOfFirstText(editor)).toContain("--notes-swatch-text-red");
		editor.getEditorState().read(() => {
			expect(readActiveSwatch(ColorTarget.Text)).toBe(SwatchColor.Red);
			expect(readActiveSwatch(ColorTarget.Highlight)).toBe(SwatchColor.Default);
		});
	});

	it("text and highlight are independent channels", () => {
		applySwatch(editor, ColorTarget.Text, SwatchColor.Red);
		applySwatch(editor, ColorTarget.Highlight, SwatchColor.Blue);
		flush(editor);
		const style = styleOfFirstText(editor);
		expect(style).toContain("--notes-swatch-text-red");
		expect(style).toContain("--notes-swatch-highlight-blue");
		editor.getEditorState().read(() => {
			expect(readActiveSwatch(ColorTarget.Text)).toBe(SwatchColor.Red);
			expect(readActiveSwatch(ColorTarget.Highlight)).toBe(SwatchColor.Blue);
		});
	});

	it("Default clears only its own channel", () => {
		applySwatch(editor, ColorTarget.Text, SwatchColor.Red);
		applySwatch(editor, ColorTarget.Highlight, SwatchColor.Blue);
		applySwatch(editor, ColorTarget.Text, SwatchColor.Default);
		flush(editor);
		const style = styleOfFirstText(editor);
		expect(style).not.toContain("--notes-swatch-text-");
		expect(style).toContain("--notes-swatch-highlight-blue");
		editor.getEditorState().read(() => {
			expect(readActiveSwatch(ColorTarget.Text)).toBe(SwatchColor.Default);
			expect(readActiveSwatch(ColorTarget.Highlight)).toBe(SwatchColor.Blue);
		});
	});

	it("readActiveSwatch is Default when there is no range selection", () => {
		const fresh = createHeadlessEditor({
			namespace: "t",
			onError: (e) => {
				throw e;
			},
		});
		fresh.update(
			() => {
				$getRoot().append($createParagraphNode().append($createTextNode("x")));
			},
			{ discrete: true },
		);
		fresh.getEditorState().read(() => {
			expect($isRangeSelection($getSelection())).toBe(false);
			expect(readActiveSwatch(ColorTarget.Text)).toBe(SwatchColor.Default);
		});
	});
});

describe("mergeStyleProp", () => {
	it("sets a property on an empty style", () => {
		expect(mergeStyleProp("", "color", "red")).toBe("color: red");
	});

	it("preserves the sibling channel when setting the other", () => {
		const withText = mergeStyleProp("", "color", "red");
		const both = mergeStyleProp(withText, "background-color", "blue");
		expect(both).toContain("color: red");
		expect(both).toContain("background-color: blue");
	});

	it("removes a property when value is null, keeping the rest", () => {
		const both = mergeStyleProp("color: red; background-color: blue", "color", null);
		expect(both).toBe("background-color: blue");
	});

	it("overwrites an existing value rather than duplicating it", () => {
		expect(mergeStyleProp("color: red", "color", "green")).toBe("color: green");
	});
});

describe("applySwatchToBlocks", () => {
	function makeTwoBlockEditor(): { editor: LexicalEditor; keys: string[] } {
		const editor = createHeadlessEditor({
			namespace: "tb",
			onError: (e) => {
				throw e;
			},
		});
		const keys: string[] = [];
		editor.update(
			() => {
				$getRoot().clear();
				for (const word of ["alpha", "bravo"]) {
					const p = $createParagraphNode();
					p.append($createTextNode(word));
					$getRoot().append(p);
					keys.push(p.getKey());
				}
			},
			{ discrete: true },
		);
		return { editor, keys };
	}

	function blockStyles(editor: LexicalEditor): string[] {
		const root = editor.getEditorState().toJSON().root as {
			children: Array<{ children?: Array<{ style?: string }> }>;
		};
		return root.children.map((b) => b.children?.[0]?.style ?? "");
	}

	it("applies a text colour to every selected block's text", () => {
		const { editor, keys } = makeTwoBlockEditor();
		applySwatchToBlocks(editor, new Set(keys), ColorTarget.Text, SwatchColor.Red);
		flush(editor);
		const expected = swatchCssValue(ColorTarget.Text, SwatchColor.Red);
		for (const style of blockStyles(editor)) expect(style).toContain(`color: ${expected}`);
	});

	it("Default clears the colour from all blocks", () => {
		const { editor, keys } = makeTwoBlockEditor();
		applySwatchToBlocks(editor, new Set(keys), ColorTarget.Text, SwatchColor.Green);
		applySwatchToBlocks(editor, new Set(keys), ColorTarget.Text, SwatchColor.Default);
		flush(editor);
		for (const style of blockStyles(editor)) expect(style).not.toContain("color:");
	});

	it("text + highlight coexist on the same blocks", () => {
		const { editor, keys } = makeTwoBlockEditor();
		applySwatchToBlocks(editor, new Set(keys), ColorTarget.Text, SwatchColor.Blue);
		applySwatchToBlocks(editor, new Set(keys), ColorTarget.Highlight, SwatchColor.Yellow);
		flush(editor);
		for (const style of blockStyles(editor)) {
			expect(style).toContain("color:");
			expect(style).toContain("background-color:");
		}
	});

	it("is a no-op for an empty key set", () => {
		const { editor } = makeTwoBlockEditor();
		applySwatchToBlocks(editor, new Set(), ColorTarget.Text, SwatchColor.Red);
		flush(editor);
		for (const style of blockStyles(editor)) expect(style).toBe("");
	});
});
