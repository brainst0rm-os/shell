// @vitest-environment jsdom
import { createHeadlessEditor } from "@lexical/headless";
import { $getRoot, type LexicalEditor, type LexicalNode } from "lexical";
import { describe, expect, it } from "vitest";
import {
	$createInlineTransclusionNode,
	$isInlineTransclusionNode,
	INLINE_TRANSCLUSION_DOM_FLAG,
	INLINE_TRANSCLUSION_DOM_FLAG_VALUE,
	INLINE_TRANSCLUSION_NODE_TYPE,
	InlineTransclusionNode,
} from "./inline-transclusion-node";

function editor(): LexicalEditor {
	return createHeadlessEditor({
		namespace: "itr",
		nodes: [InlineTransclusionNode],
		onError: (e) => {
			throw e;
		},
	});
}

describe("InlineTransclusionNode", () => {
	it("round-trips fields and is inline + keyboard-selectable", () => {
		const e = editor();
		e.update(
			() => {
				$getRoot().append(
					$createInlineTransclusionNode("ent_n", "io.brainstorm.notes/Note/v1", "Spec"),
				);
			},
			{ discrete: true },
		);
		const json = JSON.stringify(e.getEditorState().toJSON());
		const next = editor();
		next.setEditorState(next.parseEditorState(json));
		next.getEditorState().read(() => {
			const n = $getRoot().getFirstChild();
			expect($isInlineTransclusionNode(n)).toBe(true);
			if (!$isInlineTransclusionNode(n)) return;
			expect(n.isInline()).toBe(true);
			expect(n.isKeyboardSelectable()).toBe(true);
			expect(n.getEntityId()).toBe("ent_n");
			expect(n.getEntityType()).toBe("io.brainstorm.notes/Note/v1");
			expect(n.getLabel()).toBe("Spec");
			expect(n.getTextContent()).toBe("↪ Spec");
			expect(n.exportJSON()).toMatchObject({
				type: INLINE_TRANSCLUSION_NODE_TYPE,
				version: 1,
				entityId: "ent_n",
				entityType: "io.brainstorm.notes/Note/v1",
				label: "Spec",
			});
		});
	});

	it("getTextContent does not leak the brainstorm:// URI", () => {
		const e = editor();
		e.update(
			() => {
				$getRoot().append($createInlineTransclusionNode("ent_x", "T/v1", "Hi"));
			},
			{ discrete: true },
		);
		e.getEditorState().read(() => {
			const n = $getRoot().getFirstChild();
			if (!$isInlineTransclusionNode(n)) throw new Error("expected inline transclusion");
			expect(n.getTextContent().includes("brainstorm://")).toBe(false);
			expect(n.getTextContent().includes("ent_x")).toBe(false);
		});
	});

	it("importJSON clamps oversize fields + strips bidi/zero-width controls", () => {
		const dirty = `before‮​evil${"x".repeat(2048)}`;
		const e = editor();
		e.update(
			() => {
				$getRoot().append(
					InlineTransclusionNode.importJSON({
						type: INLINE_TRANSCLUSION_NODE_TYPE,
						version: 1,
						entityId: dirty,
						entityType: dirty,
						label: dirty,
					}),
				);
			},
			{ discrete: true },
		);
		e.getEditorState().read(() => {
			const n = $getRoot().getFirstChild();
			if (!$isInlineTransclusionNode(n)) throw new Error("expected inline transclusion");
			expect(n.getEntityId().length).toBe(1024);
			expect(n.getEntityId().startsWith("beforeevil")).toBe(true);
			expect(n.getEntityId().includes("‮")).toBe(false);
			expect(n.getEntityId().includes("​")).toBe(false);
		});
	});

	it("importJSON coerces non-string fields to empty", () => {
		const e = editor();
		e.update(
			() => {
				$getRoot().append(
					InlineTransclusionNode.importJSON({
						type: INLINE_TRANSCLUSION_NODE_TYPE,
						version: 1,
						entityId: 42 as unknown as string,
						entityType: null as unknown as string,
						label: undefined as unknown as string,
					}),
				);
			},
			{ discrete: true },
		);
		e.getEditorState().read(() => {
			const n = $getRoot().getFirstChild();
			if (!$isInlineTransclusionNode(n)) throw new Error("expected inline transclusion");
			expect(n.getEntityId()).toBe("");
			expect(n.getEntityType()).toBe("");
			expect(n.getLabel()).toBe("");
		});
	});

	it("exportDOM emits an inline anchor with the flag + URL-encoded href + 2 children, no script chrome", () => {
		const e = editor();
		e.update(
			() => {
				$getRoot().append($createInlineTransclusionNode("ent#a/b?c", "T/v1", "My ref"));
			},
			{ discrete: true },
		);
		e.getEditorState().read(() => {
			const n = $getRoot().getFirstChild();
			if (!$isInlineTransclusionNode(n)) throw new Error("expected inline transclusion");
			const { element } = n.exportDOM();
			if (!(element instanceof HTMLAnchorElement)) throw new Error("expected <a>");
			expect(element.getAttribute(INLINE_TRANSCLUSION_DOM_FLAG)).toBe(
				INLINE_TRANSCLUSION_DOM_FLAG_VALUE,
			);
			expect(element.getAttribute("href")).toBe("brainstorm://entity/ent%23a%2Fb%3Fc");
			expect(element.getAttribute("data-entity-id")).toBe("ent#a/b?c");
			expect(element.getAttribute("data-label")).toBe("My ref");
			expect(element.querySelector("script, img, svg, iframe, object, embed")).toBeNull();
			expect(element.children.length).toBe(2);
			expect(element.children[0]?.textContent).toBe("↪");
			expect(element.children[1]?.textContent).toBe("My ref");
		});
	});

	it("importDOM round-trips an exported anchor", () => {
		const e = editor();
		let html = "";
		e.update(
			() => {
				$getRoot().append($createInlineTransclusionNode("ent_a", "T/v1", "Origin"));
			},
			{ discrete: true },
		);
		e.getEditorState().read(() => {
			const n = $getRoot().getFirstChild();
			if (!$isInlineTransclusionNode(n)) throw new Error("expected inline transclusion");
			const { element } = n.exportDOM();
			if (!(element instanceof HTMLAnchorElement)) throw new Error("expected <a>");
			html = element.outerHTML;
		});
		const anchor = new DOMParser().parseFromString(html, "text/html").querySelector("a");
		expect(anchor).not.toBeNull();
		if (!anchor) return;
		const target = editor();
		target.update(
			() => {
				const handler = InlineTransclusionNode.importDOM()?.a?.(anchor);
				expect(handler).not.toBeNull();
				if (!handler) return;
				const out = handler.conversion(anchor);
				if (!out) throw new Error("expected DOMConversionOutput");
				const node: LexicalNode | null = (Array.isArray(out.node) ? out.node[0] : out.node) ?? null;
				expect($isInlineTransclusionNode(node)).toBe(true);
				if (!$isInlineTransclusionNode(node)) return;
				expect(node.getEntityId()).toBe("ent_a");
				expect(node.getLabel()).toBe("Origin");
			},
			{ discrete: true },
		);
	});

	it("importDOM rejects a wrong flag value and an empty entity id", () => {
		const html =
			'<a href="brainstorm://entity/x" data-lexical-inline-transclusion="false" data-entity-id="x">x</a>' +
			'<a href="brainstorm://entity/" data-lexical-inline-transclusion="true" data-entity-id="">y</a>';
		const parsed = new DOMParser().parseFromString(html, "text/html");
		const anchors = parsed.querySelectorAll("a");
		const map = InlineTransclusionNode.importDOM();
		// First: wrong flag → no handler at all.
		expect(map?.a?.(anchors[0] as HTMLElement)).toBeNull();
		// Second: correct flag, empty id → conversion declines (run inside an
		// editor update since conversion may construct a node).
		const e = editor();
		let node: unknown = "sentinel";
		e.update(
			() => {
				const handler = map?.a?.(anchors[1] as HTMLElement);
				expect(handler).not.toBeNull();
				if (!handler) return;
				const out = handler.conversion(anchors[1] as HTMLElement);
				node = out ? (Array.isArray(out.node) ? (out.node[0] ?? null) : out.node) : null;
			},
			{ discrete: true },
		);
		expect(node).toBeNull();
	});
});
