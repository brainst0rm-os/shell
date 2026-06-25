// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { Doc } from "yjs";
import { BrainstormEditor } from "../editor";
import { STANDARD_ADDITIONAL_NODES } from "../standard-nodes";
import { StandardEditingPlugins } from "./standard-editing-plugins";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STATE = JSON.stringify({
	root: {
		type: "root",
		version: 1,
		direction: null,
		format: "",
		indent: 0,
		children: [
			{
				type: "heading",
				version: 1,
				tag: "h1",
				direction: null,
				format: "",
				indent: 0,
				children: [
					{ type: "text", version: 1, text: "Title", format: 0, detail: 0, mode: "normal", style: "" },
				],
			},
			{
				type: "paragraph",
				version: 1,
				direction: null,
				format: "",
				indent: 0,
				children: [
					{ type: "text", version: 1, text: "Body", format: 0, detail: 0, mode: "normal", style: "" },
				],
			},
		],
	},
});

describe("StandardEditingPlugins", () => {
	it("mounts inside BrainstormEditor and seeds rich content without throwing", async () => {
		const doc = new Doc();
		const host = document.createElement("div");
		document.body.appendChild(host);
		const root = createRoot(host);

		await act(async () => {
			root.render(
				<BrainstormEditor
					doc={doc}
					namespace="test"
					additionalNodes={STANDARD_ADDITIONAL_NODES}
					initialEditorState={STATE}
				>
					<StandardEditingPlugins scrollContainerSelector=".host" />
				</BrainstormEditor>,
			);
		});
		await act(async () => void (await new Promise((r) => setTimeout(r, 15))));

		const editable = host.querySelector(".bs-editor__contenteditable");
		expect(editable?.children.length).toBe(2);
		expect(editable?.querySelector("h1")?.textContent).toBe("Title");

		await act(async () => root.unmount());
	});
});
