/**
 * @vitest-environment jsdom
 *
 * B11.9 presence publication. Pins that `<BrainstormEditor presence>`
 * forwards the local collaborator identity to `<CollaborationPlugin>`,
 * which writes `{ name, color }` into the Yjs awareness channel on focus
 * (so a synced peer renders this client's remote cursor) and clears the
 * focusing flag on blur. The cursor DOM itself is rendered by
 * `@lexical/yjs` from real layout rects, so its visual proof is a
 * real-shell multi-peer spec — this test owns the awareness contract.
 */

import { BLUR_COMMAND, FOCUS_COMMAND, type LexicalEditor } from "lexical";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Doc } from "yjs";
import { BrainstormEditor } from "./editor";
import { createLocalProvider } from "./local-provider";
import { EditorCapturePlugin } from "./plugins/dev-bench";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let reactRoot: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	reactRoot = createRoot(container);
});

afterEach(() => {
	act(() => reactRoot.unmount());
	container.remove();
});

interface AwarenessLike {
	getLocalState(): Record<string, unknown> | null;
}

async function mountWithPresence(presence: { name: string; color: string }): Promise<{
	editor: LexicalEditor;
	awareness: AwarenessLike;
}> {
	const doc = new Doc();
	let captured: AwarenessLike | null = null;
	let editor: LexicalEditor | null = null;
	await act(async () => {
		reactRoot.render(
			<BrainstormEditor
				doc={doc}
				docId="t"
				presence={presence}
				providerFactory={(d) => {
					const provider = createLocalProvider(d);
					captured = provider.awareness as unknown as AwarenessLike;
					return provider;
				}}
			>
				<EditorCapturePlugin
					onMount={(e) => {
						editor = e;
					}}
				/>
			</BrainstormEditor>,
		);
		await Promise.resolve();
	});
	if (!editor || !captured) throw new Error("editor/awareness not captured");
	return { editor, awareness: captured };
}

describe("BrainstormEditor presence publication", () => {
	it("publishes name + colour into awareness on focus", async () => {
		const { editor, awareness } = await mountWithPresence({ name: "Ada", color: "#2f6df6" });
		act(() => {
			editor.dispatchCommand(FOCUS_COMMAND, undefined as never);
		});
		const state = awareness.getLocalState();
		expect(state).not.toBeNull();
		expect(state?.name).toBe("Ada");
		expect(state?.color).toBe("#2f6df6");
		expect(state?.focusing).toBe(true);
	});

	it("clears the focusing flag on blur but keeps identity", async () => {
		const { editor, awareness } = await mountWithPresence({ name: "Ada", color: "#2f6df6" });
		act(() => {
			editor.dispatchCommand(FOCUS_COMMAND, undefined as never);
		});
		act(() => {
			editor.dispatchCommand(BLUR_COMMAND, undefined as never);
		});
		const state = awareness.getLocalState();
		expect(state?.focusing).toBe(false);
		expect(state?.name).toBe("Ada");
	});
});
