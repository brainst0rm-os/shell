// @vitest-environment jsdom
import { createHeadlessEditor } from "@lexical/headless";
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalEditor } from "lexical";
import { describe, expect, it } from "vitest";
import { CalloutTone } from "../block-types";
import {
	$createCalloutNode,
	$isCalloutNode,
	CALLOUT_NODE_TYPE,
	CalloutNode,
	type SerializedCalloutNode,
} from "./callout-node";

function createEditor(): LexicalEditor {
	return createHeadlessEditor({
		nodes: [CalloutNode],
		onError(error) {
			throw error;
		},
	});
}

describe("CalloutNode", () => {
	it("defaults to the Neutral tone and is type-tagged", () => {
		const editor = createEditor();
		let tone = "";
		let type = "";
		editor.update(
			() => {
				const node = $createCalloutNode();
				tone = node.getTone();
				type = CalloutNode.getType();
			},
			{ discrete: true },
		);
		expect(tone).toBe(CalloutTone.Neutral);
		expect(type).toBe(CALLOUT_NODE_TYPE);
	});

	it("setTone mutates the writable node", () => {
		const editor = createEditor();
		let tone = "";
		editor.update(
			() => {
				const node = $createCalloutNode(CalloutTone.Info);
				node.setTone(CalloutTone.Danger);
				tone = node.getTone();
			},
			{ discrete: true },
		);
		expect(tone).toBe(CalloutTone.Danger);
	});

	it("$isCalloutNode narrows correctly", () => {
		const editor = createEditor();
		let results: [boolean, boolean] = [false, false];
		editor.update(
			() => {
				results = [$isCalloutNode($createCalloutNode()), $isCalloutNode($createParagraphNode())];
			},
			{ discrete: true },
		);
		expect(results).toEqual([true, false]);
	});

	it("exports + re-imports JSON round-trip preserving tone", () => {
		const editor = createEditor();
		let serialized: SerializedCalloutNode | null = null;
		let reimportedTone = "";
		editor.update(
			() => {
				const node = $createCalloutNode(CalloutTone.Warn);
				node.append($createTextNode("heads up"));
				$getRoot().append(node);
				serialized = node.exportJSON();
				reimportedTone = CalloutNode.importJSON(serialized).getTone();
			},
			{ discrete: true },
		);
		expect(serialized).toMatchObject({
			type: CALLOUT_NODE_TYPE,
			version: 1,
			tone: CalloutTone.Warn,
		});
		expect(reimportedTone).toBe(CalloutTone.Warn);
	});

	it("importJSON coerces an unknown tone to Neutral (never throws on bad data)", () => {
		const editor = createEditor();
		let tone = "";
		editor.update(
			() => {
				const node = CalloutNode.importJSON({
					type: CALLOUT_NODE_TYPE,
					version: 1,
					tone: "chartreuse" as CalloutTone,
					children: [],
					direction: null,
					format: "",
					indent: 0,
					textFormat: 0,
					textStyle: "",
				} as SerializedCalloutNode);
				tone = node.getTone();
			},
			{ discrete: true },
		);
		expect(tone).toBe(CalloutTone.Neutral);
	});

	it("survives a full editor-state parse round-trip (valid serialized node)", () => {
		const editor = createEditor();
		editor.update(
			() => {
				const node = $createCalloutNode(CalloutTone.Success);
				node.append($createTextNode("done"));
				$getRoot().append(node);
			},
			{ discrete: true },
		);
		const json = editor.getEditorState().toJSON();
		// The exact failure mode we fought with seeded bodies: a node that
		// can't be re-parsed. Must not throw.
		const restored = editor.parseEditorState(JSON.stringify(json));
		expect(restored.isEmpty()).toBe(false);
	});
});
