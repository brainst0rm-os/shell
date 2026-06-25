// @vitest-environment jsdom
import { CodeNode } from "@lexical/code";
import { createHeadlessEditor } from "@lexical/headless";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { $getRoot, type LexicalEditor } from "lexical";
import { describe, expect, it } from "vitest";
import {
	$createPropertyListBlockNode,
	$isPropertyListBlockNode,
	PROPERTY_LIST_BLOCK_TYPE,
	PropertyListBlockNode,
	type SerializedPropertyListBlockNode,
} from "./property-list-block-node";

function createEditor(): LexicalEditor {
	return createHeadlessEditor({
		nodes: [
			HeadingNode,
			QuoteNode,
			ListNode,
			ListItemNode,
			CodeNode,
			LinkNode,
			AutoLinkNode,
			PropertyListBlockNode,
		],
		onError(error) {
			throw error;
		},
	});
}

describe("PropertyListBlockNode", () => {
	it("creates with empty propertyKeys + default state", () => {
		const editor = createEditor();
		let result = { keys: [] as readonly string[], title: null as string | null, collapsed: true };
		editor.update(
			() => {
				const node = $createPropertyListBlockNode();
				result = {
					keys: node.getPropertyKeys(),
					title: node.getTitle(),
					collapsed: node.getCollapsed(),
				};
			},
			{ discrete: true },
		);
		expect(result.keys).toEqual([]);
		expect(result.title).toBeNull();
		expect(result.collapsed).toBe(false);
	});

	it("creates with N property keys + a title + a collapsed flag", () => {
		const editor = createEditor();
		let after = { keys: [] as readonly string[], title: null as string | null, collapsed: false };
		editor.update(
			() => {
				const node = $createPropertyListBlockNode(["a", "b", "c"], "Metadata", true);
				after = {
					keys: node.getPropertyKeys(),
					title: node.getTitle(),
					collapsed: node.getCollapsed(),
				};
			},
			{ discrete: true },
		);
		expect(after.keys).toEqual(["a", "b", "c"]);
		expect(after.title).toBe("Metadata");
		expect(after.collapsed).toBe(true);
	});

	it("constructor copies propertyKeys (callers can mutate input without bleed)", () => {
		const editor = createEditor();
		const input = ["a", "b"];
		let storedKeys: readonly string[] = [];
		editor.update(
			() => {
				const node = $createPropertyListBlockNode(input);
				input.push("c");
				storedKeys = node.getPropertyKeys();
			},
			{ discrete: true },
		);
		expect(storedKeys).toEqual(["a", "b"]);
	});

	it("$isPropertyListBlockNode discriminates", () => {
		const editor = createEditor();
		let isList = false;
		editor.update(
			() => {
				isList = $isPropertyListBlockNode($createPropertyListBlockNode());
			},
			{ discrete: true },
		);
		expect(isList).toBe(true);
		expect($isPropertyListBlockNode(null)).toBe(false);
		expect($isPropertyListBlockNode(undefined)).toBe(false);
	});

	it("round-trips through exportJSON → importJSON", () => {
		const editor = createEditor();
		let json: SerializedPropertyListBlockNode | null = null;
		let restored: {
			keys: readonly string[];
			title: string | null;
			collapsed: boolean;
			blockId: string;
		} | null = null;
		editor.update(
			() => {
				const original = $createPropertyListBlockNode(
					["k1", "k2"],
					"My Properties",
					true,
					"plb_seeded_1",
				);
				json = original.exportJSON();
				const back = PropertyListBlockNode.importJSON(json);
				restored = {
					keys: back.getPropertyKeys(),
					title: back.getTitle(),
					collapsed: back.getCollapsed(),
					blockId: back.getBlockId(),
				};
			},
			{ discrete: true },
		);
		const captured = json as ReturnType<PropertyListBlockNode["exportJSON"]> | null;
		expect(captured?.type).toBe(PROPERTY_LIST_BLOCK_TYPE);
		expect(captured?.version).toBe(1);
		expect(restored).toEqual({
			keys: ["k1", "k2"],
			title: "My Properties",
			collapsed: true,
			blockId: "plb_seeded_1",
		});
	});

	it("importJSON filters non-string entries from propertyKeys (corrupt data)", () => {
		const editor = createEditor();
		let keys: readonly string[] = [];
		editor.update(
			() => {
				const json = {
					type: PROPERTY_LIST_BLOCK_TYPE,
					version: 1,
					blockId: "plb_x",
					// biome-ignore lint/suspicious/noExplicitAny: testing tolerance to corrupt data
					propertyKeys: ["a", null, "b", 42, "c"] as any,
					title: null,
					collapsed: false,
				} satisfies SerializedPropertyListBlockNode;
				keys = PropertyListBlockNode.importJSON(json).getPropertyKeys();
			},
			{ discrete: true },
		);
		expect(keys).toEqual(["a", "b", "c"]);
	});

	it("importJSON treats missing/non-string title as null", () => {
		const editor = createEditor();
		let title: string | null = "preset";
		editor.update(
			() => {
				const json = {
					type: PROPERTY_LIST_BLOCK_TYPE,
					version: 1,
					blockId: "plb_y",
					propertyKeys: [],
					// biome-ignore lint/suspicious/noExplicitAny: testing tolerance to legacy snapshots
					title: undefined as any,
					collapsed: false,
				} satisfies SerializedPropertyListBlockNode;
				title = PropertyListBlockNode.importJSON(json).getTitle();
			},
			{ discrete: true },
		);
		expect(title).toBeNull();
	});

	it("appends as a top-level block in an editor", () => {
		const editor = createEditor();
		editor.update(
			() => {
				const root = $getRoot();
				root.clear();
				root.append($createPropertyListBlockNode(["k1"], "Top"));
			},
			{ discrete: true },
		);
		let foundType = "";
		editor.getEditorState().read(() => {
			const first = $getRoot().getFirstChild();
			foundType = first?.getType() ?? "";
		});
		expect(foundType).toBe(PROPERTY_LIST_BLOCK_TYPE);
	});

	it("preserves type + state across editor.toJSON → parseEditorState", () => {
		const editor = createEditor();
		editor.update(
			() => {
				const root = $getRoot();
				root.clear();
				root.append($createPropertyListBlockNode(["a", "b"], "Round-trip", false, "plb_snap_1"));
			},
			{ discrete: true },
		);
		const snapshot = editor.getEditorState().toJSON();
		const otherEditor = createEditor();
		const state = otherEditor.parseEditorState(JSON.stringify(snapshot));
		otherEditor.setEditorState(state);

		let restored: {
			type: string;
			keys: readonly string[];
			title: string | null;
			collapsed: boolean;
			blockId: string;
		} | null = null;
		otherEditor.getEditorState().read(() => {
			const first = $getRoot().getFirstChild();
			if ($isPropertyListBlockNode(first)) {
				restored = {
					type: first.getType(),
					keys: first.getPropertyKeys(),
					title: first.getTitle(),
					collapsed: first.getCollapsed(),
					blockId: first.getBlockId(),
				};
			}
		});
		expect(restored).toEqual({
			type: PROPERTY_LIST_BLOCK_TYPE,
			keys: ["a", "b"],
			title: "Round-trip",
			collapsed: false,
			blockId: "plb_snap_1",
		});
	});

	it("clone deep-copies propertyKeys + carries title/collapsed/blockId", () => {
		const editor = createEditor();
		let cloned: {
			keys: readonly string[];
			title: string | null;
			collapsed: boolean;
			blockId: string;
		} = {
			keys: [],
			title: null,
			collapsed: false,
			blockId: "",
		};
		let originalKeysShared = true;
		editor.update(
			() => {
				const original = $createPropertyListBlockNode(["a", "b"], "Doc", true, "plb_c_1");
				const copy = PropertyListBlockNode.clone(original);
				originalKeysShared = original.getPropertyKeys() === copy.getPropertyKeys();
				cloned = {
					keys: copy.getPropertyKeys(),
					title: copy.getTitle(),
					collapsed: copy.getCollapsed(),
					blockId: copy.getBlockId(),
				};
			},
			{ discrete: true },
		);
		expect(originalKeysShared).toBe(false);
		expect(cloned).toEqual({
			keys: ["a", "b"],
			title: "Doc",
			collapsed: true,
			blockId: "plb_c_1",
		});
	});

	it("add / remove / setPropertyKeys mutate through getWritable", () => {
		const editor = createEditor();
		let after: readonly string[] = [];
		editor.update(
			() => {
				const node = $createPropertyListBlockNode(["a", "b"]);
				node.addPropertyKey("c");
				node.addPropertyKey("a"); // duplicate — no-op.
				node.removePropertyKey("b");
				after = node.getPropertyKeys();
			},
			{ discrete: true },
		);
		expect(after).toEqual(["a", "c"]);
	});

	it("setTitle / setCollapsed write through getWritable", () => {
		const editor = createEditor();
		let after = { title: null as string | null, collapsed: false };
		editor.update(
			() => {
				const node = $createPropertyListBlockNode();
				node.setTitle("New Title");
				node.setCollapsed(true);
				after = { title: node.getTitle(), collapsed: node.getCollapsed() };
			},
			{ discrete: true },
		);
		expect(after).toEqual({ title: "New Title", collapsed: true });
	});

	it("decorate returns a JSX element", () => {
		const editor = createEditor();
		let isElement = false;
		editor.update(
			() => {
				const node = $createPropertyListBlockNode(["k"]);
				const out = node.decorate();
				// Coarse `typeof` check; full render exercised in
				// `property-block-decorator.test.tsx`.
				isElement = typeof out === "object" && out !== null;
			},
			{ discrete: true },
		);
		expect(isElement).toBe(true);
	});
});
