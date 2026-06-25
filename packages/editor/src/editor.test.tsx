// @vitest-environment jsdom
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalEditor } from "lexical";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Doc, XmlText } from "yjs";
import { BrainstormEditor } from "./editor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("<BrainstormEditor>", () => {
	it("mounts a contenteditable and binds Lexical to the passed Y.Doc", async () => {
		const doc = new Doc();
		await act(async () => {
			root.render(<BrainstormEditor doc={doc} docId="main" placeholder="Write…" />);
		});
		// allow the local provider's queued sync + collaboration bootstrap
		await act(async () => {
			await Promise.resolve();
		});

		const editable = container.querySelector('[contenteditable="true"]');
		expect(editable).not.toBeNull();

		// @lexical/yjs registered + bootstrapped the shared root under docId,
		// proving the editor state is Yjs-backed (not local-only).
		expect(doc.share.has("root")).toBe(true);
		expect(doc.get("root", XmlText)).toBeInstanceOf(XmlText);
	});

	it("renders a locked editor when editable=false (still Yjs-backed)", async () => {
		const doc = new Doc();
		await act(async () => {
			root.render(<BrainstormEditor doc={doc} editable={false} />);
		});
		await act(async () => {
			await Promise.resolve();
		});
		expect(container.querySelector('[contenteditable="false"]')).not.toBeNull();
		expect(doc.share.has("root")).toBe(true);
	});

	it("forwards `initialEditorState` to CollaborationPlugin so a fresh doc bootstraps with caller content", async () => {
		// The shouldBootstrap-compatible seeder runs exactly once per empty
		// root XmlText (the `root._xmlText._length === 0` gate inside
		// `useYjsCollaboration`). After bootstrap the doc carries the
		// seeded text and a second consumer of the SAME doc sees it
		// without firing its own seeder.
		const doc = new Doc();
		const initializer = (_editor: LexicalEditor) => {
			void _editor;
			const root1 = $getRoot();
			if (!root1.isEmpty()) return;
			root1.append($createParagraphNode().append($createTextNode("seeded once")));
		};
		await act(async () => {
			root.render(<BrainstormEditor doc={doc} docId="seed-test" initialEditorState={initializer} />);
		});
		await act(async () => {
			await Promise.resolve();
		});

		const body = doc.get("root", XmlText);
		expect(body.toString()).toContain("seeded once");
		// Second consumer of the same doc through the same id — the bootstrap
		// gate now sees a non-empty root and skips, so we don't double-seed.
		const baseline = body.toString();
		await act(async () => {
			root.render(
				<>
					<BrainstormEditor doc={doc} docId="seed-test" initialEditorState={initializer} />
					<BrainstormEditor doc={doc} docId="seed-test-2" initialEditorState={initializer} />
				</>,
			);
		});
		await act(async () => {
			await Promise.resolve();
		});
		// The single "seeded once" survived; we did not paste a second copy.
		expect(body.toString().split("seeded once").length - 1).toBe(1);
		expect(body.toString()).toBe(baseline);
	});
});
