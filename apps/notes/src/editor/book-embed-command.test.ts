// @vitest-environment jsdom
/**
 * Wires-up tests for the `/book` slash command (Books 9.21.7): the
 * command opens the shared embed picker scoped to `brainstorm/Highlight/v1`,
 * and the picker store carries the type filter through. The picker
 * plugin's list-narrowing rides the same `typeFilter` field as `/graph`.
 */

import { CodeNode } from "@lexical/code";
import { createHeadlessEditor } from "@lexical/headless";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalEditor } from "lexical";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BLOCK_COMMANDS, CommandCategory } from "./commands";
import { embedPickerStore } from "./embed-picker-store";

function makeEditor(): LexicalEditor {
	return createHeadlessEditor({
		nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode, LinkNode, AutoLinkNode],
		onError(err) {
			throw err;
		},
	});
}

function stubGetElementByKey(editor: LexicalEditor): void {
	const fake = {
		getBoundingClientRect(): DOMRect {
			return {
				top: 100,
				bottom: 120,
				left: 50,
				right: 200,
				width: 150,
				height: 20,
				x: 50,
				y: 100,
				toJSON: () => ({}),
			} as DOMRect;
		},
	} as HTMLElement;
	(editor as unknown as { getElementByKey: () => HTMLElement | null }).getElementByKey = () => fake;
}

function seedEmptyParagraph(editor: LexicalEditor): void {
	editor.update(
		() => {
			const root = $getRoot();
			root.clear();
			const p = $createParagraphNode();
			p.append($createTextNode(""));
			root.append(p);
			p.selectStart();
		},
		{ discrete: true },
	);
}

beforeEach(() => {
	embedPickerStore.close();
});
afterEach(() => {
	embedPickerStore.close();
});

describe("/book slash command (block.embed.book)", () => {
	const slash = BLOCK_COMMANDS.find((c) => c.id === "block.embed.book");

	it("is registered under the Embed category with a 'highlight' keyword", () => {
		expect(slash).toBeDefined();
		expect(slash?.category).toBe(CommandCategory.Embed);
		expect(slash?.keywords).toContain("highlight");
		expect(slash?.keywords).toContain("book");
	});

	it("opens the embed picker scoped to brainstorm/Highlight/v1", () => {
		expect(slash).toBeDefined();
		const editor = makeEditor();
		stubGetElementByKey(editor);
		seedEmptyParagraph(editor);

		slash?.run({ editor });

		const target = embedPickerStore.getSnapshot();
		expect(target).not.toBeNull();
		expect(target?.typeFilter).toBe("brainstorm/Highlight/v1");
	});

	it("the generic /embed command stays unscoped", () => {
		const generic = BLOCK_COMMANDS.find((c) => c.id === "block.embed.entity");
		expect(generic).toBeDefined();
		const editor = makeEditor();
		stubGetElementByKey(editor);
		seedEmptyParagraph(editor);

		generic?.run({ editor });

		const target = embedPickerStore.getSnapshot();
		expect(target).not.toBeNull();
		expect(target?.typeFilter).toBeUndefined();
	});
});
