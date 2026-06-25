import { $isListItemNode, $isListNode } from "@lexical/list";
// @vitest-environment happy-dom
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createParagraphNode, $getRoot, type LexicalEditor } from "lexical";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { Doc } from "yjs";
import { BlockType } from "../block-types";
import { BrainstormEditor } from "../editor";
import { STANDARD_ADDITIONAL_NODES } from "../standard-nodes";
import { StandardEditingPlugins } from "./standard-editing-plugins";
import { TURN_INTO_COMMAND } from "./turn-into-plugin";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function CaptureEditor({ onReady }: { onReady: (e: LexicalEditor) => void }) {
	const [editor] = useLexicalComposerContext();
	onReady(editor);
	return null;
}

describe("turn into To-do list", () => {
	it("inserts a fresh to-do item UNCHECKED (not pre-completed)", async () => {
		const doc = new Doc();
		const host = document.createElement("div");
		document.body.appendChild(host);
		const root = createRoot(host);
		let editor: LexicalEditor | null = null;

		await act(async () => {
			root.render(
				<BrainstormEditor doc={doc} namespace="test" additionalNodes={STANDARD_ADDITIONAL_NODES}>
					<StandardEditingPlugins />
					<CaptureEditor
						onReady={(e) => {
							editor = e;
						}}
					/>
				</BrainstormEditor>,
			);
		});
		await act(async () => void (await new Promise((r) => setTimeout(r, 30))));
		const ed = editor as unknown as LexicalEditor;
		expect(ed).toBeTruthy();

		await act(async () => {
			ed.update(() => {
				const r = $getRoot();
				r.clear();
				const p = $createParagraphNode();
				r.append(p);
				p.selectStart();
			});
		});
		await act(async () => {
			ed.dispatchCommand(TURN_INTO_COMMAND, BlockType.TodoList);
		});
		await act(async () => void (await new Promise((r) => setTimeout(r, 30))));

		let listType = "";
		let firstItemChecked: boolean | undefined;
		ed.getEditorState().read(() => {
			const list = $getRoot().getFirstChild();
			if ($isListNode(list)) {
				listType = list.getListType();
				const item = list.getFirstChild();
				if ($isListItemNode(item)) firstItemChecked = item.getChecked();
			}
		});

		expect(listType, "block should become a check list").toBe("check");
		expect(firstItemChecked, "a brand-new to-do must start unchecked").toBe(false);

		await act(async () => root.unmount());
	});
});
