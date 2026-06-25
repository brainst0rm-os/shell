// @vitest-environment happy-dom
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
	$createParagraphNode,
	$getRoot,
	$getSelection,
	$isRangeSelection,
	KEY_ENTER_COMMAND,
	type LexicalEditor,
} from "lexical";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { Doc } from "yjs";
import { BrainstormEditor } from "../editor";
import { STANDARD_ADDITIONAL_NODES } from "../standard-nodes";
import { StandardEditingPlugins } from "./standard-editing-plugins";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function CaptureEditor({ onReady }: { onReady: (e: LexicalEditor) => void }) {
	const [editor] = useLexicalComposerContext();
	onReady(editor);
	return null;
}

describe("slash menu Enter", () => {
	it("inserts the highlighted block on Enter", async () => {
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

		// Seed an empty paragraph, select it, type "/h1".
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
			ed.update(() => {
				const sel = $getSelection();
				if ($isRangeSelection(sel)) sel.insertText("/h1");
			});
		});
		// Let the slash menu's update listener + React state settle.
		await act(async () => void (await new Promise((r) => setTimeout(r, 30))));

		// The slash menu now opens on the shared menu runtime (controlled-list);
		// this bare editor harness mounts no menu provider, so the popup fails
		// soft. What the test verifies is the host-owned keyboard path — Enter
		// committing the highlighted command — which is independent of the visual
		// menu. (The legacy hand-rolled div is gone; rendering is shell-verified.)
		expect(host.querySelector(".bs-editor__slash-menu")).toBeNull();

		// Press Enter.
		let handled = false;
		await act(async () => {
			handled = ed.dispatchCommand(KEY_ENTER_COMMAND, null);
		});
		await act(async () => void (await new Promise((r) => setTimeout(r, 30))));

		expect(handled, "Enter should be handled by the slash menu").toBe(true);

		// The "/h1" paragraph should have turned into a heading.
		let firstTag = "";
		ed.getEditorState().read(() => {
			const first = $getRoot().getFirstChild();
			firstTag = first?.getType() ?? "";
		});
		expect(firstTag, "first block should have turned into a heading").toBe("heading");

		await act(async () => root.unmount());
	});
});
