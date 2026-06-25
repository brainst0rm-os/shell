// @vitest-environment jsdom
import { createHeadlessEditor } from "@lexical/headless";
import { $getRoot, type LexicalEditor } from "lexical";
import { describe, expect, it } from "vitest";
import {
	$createTransclusionNode,
	$isTransclusionNode,
	TRANSCLUSION_DOM_FLAG,
	TRANSCLUSION_DOM_FLAG_VALUE,
	TRANSCLUSION_NODE_TYPE,
	TransclusionNode,
} from "./transclusion-node";

function editor(): LexicalEditor {
	return createHeadlessEditor({
		namespace: "tr",
		nodes: [TransclusionNode],
		onError: (e) => {
			throw e;
		},
	});
}

describe("TransclusionNode", () => {
	it("round-trips entityId / entityType / label and is block-level + keyboard-selectable", () => {
		const e = editor();
		e.update(
			() => {
				$getRoot().append(
					$createTransclusionNode("ent_note1", "io.brainstorm.notes/Note/v1", "Quarterly review"),
				);
			},
			{ discrete: true },
		);
		const json = JSON.stringify(e.getEditorState().toJSON());

		const next = editor();
		next.setEditorState(next.parseEditorState(json));
		next.getEditorState().read(() => {
			const n = $getRoot().getFirstChild();
			expect($isTransclusionNode(n)).toBe(true);
			if (!$isTransclusionNode(n)) return;
			expect(n.isInline()).toBe(false);
			expect(n.isKeyboardSelectable()).toBe(true);
			expect(n.getEntityId()).toBe("ent_note1");
			expect(n.getEntityType()).toBe("io.brainstorm.notes/Note/v1");
			expect(n.getLabel()).toBe("Quarterly review");
			expect(n.getTextContent()).toBe("↪ Quarterly review");
			expect(n.exportJSON()).toMatchObject({
				type: TRANSCLUSION_NODE_TYPE,
				version: 1,
				entityId: "ent_note1",
				entityType: "io.brainstorm.notes/Note/v1",
				label: "Quarterly review",
			});
		});
	});

	it("getTextContent does not leak the brainstorm:// URI", () => {
		// Plain-text consumers (screen readers, search index, markdown
		// export) want the label, not the entity URI; the URI already
		// reaches the clipboard via the HTML `<a href>` (exportDOM).
		const e = editor();
		e.update(
			() => {
				$getRoot().append($createTransclusionNode("ent_x", "io.brainstorm.notes/Note/v1", "Hello"));
			},
			{ discrete: true },
		);
		e.getEditorState().read(() => {
			const n = $getRoot().getFirstChild();
			if (!$isTransclusionNode(n)) throw new Error("expected transclusion");
			const text = n.getTextContent();
			expect(text.includes("brainstorm://")).toBe(false);
			expect(text.includes("ent_x")).toBe(false);
		});
	});

	it("importJSON clamps oversize fields (1024 char cap) — guard against hostile imports", () => {
		const oversize = "x".repeat(2048);
		const e = editor();
		e.update(
			() => {
				const n = TransclusionNode.importJSON({
					type: TRANSCLUSION_NODE_TYPE,
					version: 1,
					entityId: oversize,
					entityType: "io.brainstorm.notes/Note/v1",
					label: oversize,
				});
				$getRoot().append(n);
			},
			{ discrete: true },
		);
		e.getEditorState().read(() => {
			const n = $getRoot().getFirstChild();
			if (!$isTransclusionNode(n)) throw new Error("expected transclusion");
			expect(n.getEntityId().length).toBe(1024);
			expect(n.getLabel().length).toBe(1024);
		});
	});

	it("importJSON strips bidi-override + zero-width controls from every field", () => {
		// U+202E (RIGHT-TO-LEFT OVERRIDE) + U+200B (ZERO-WIDTH SPACE) +
		// U+0007 (BELL, ASCII C0). All three should leave no trace.
		const dirty = "before‮​evil";
		const e = editor();
		e.update(
			() => {
				const n = TransclusionNode.importJSON({
					type: TRANSCLUSION_NODE_TYPE,
					version: 1,
					entityId: dirty,
					entityType: dirty,
					label: dirty,
				});
				$getRoot().append(n);
			},
			{ discrete: true },
		);
		e.getEditorState().read(() => {
			const n = $getRoot().getFirstChild();
			if (!$isTransclusionNode(n)) throw new Error("expected transclusion");
			const clean = "beforeevil";
			expect(n.getEntityId()).toBe(clean);
			expect(n.getEntityType()).toBe(clean);
			expect(n.getLabel()).toBe(clean);
		});
	});

	it("exportDOM emits an anchor with the load-bearing flag, URL-encoded href, and inline card chrome", () => {
		const e = editor();
		e.update(
			() => {
				$getRoot().append(
					$createTransclusionNode("ent#with/special?chars", "io.brainstorm.notes/Note/v1", "My note"),
				);
			},
			{ discrete: true },
		);
		e.getEditorState().read(() => {
			const n = $getRoot().getFirstChild();
			if (!$isTransclusionNode(n)) throw new Error("expected transclusion");
			const { element } = n.exportDOM();
			if (!(element instanceof HTMLAnchorElement)) {
				throw new Error("expected <a>");
			}
			expect(element.getAttribute(TRANSCLUSION_DOM_FLAG)).toBe(TRANSCLUSION_DOM_FLAG_VALUE);
			expect(element.getAttribute("data-entity-id")).toBe("ent#with/special?chars");
			expect(element.getAttribute("data-entity-type")).toBe("io.brainstorm.notes/Note/v1");
			expect(element.getAttribute("data-label")).toBe("My note");
			// `#`, `/`, `?` must be percent-encoded so the URL parser
			// reaches the routing layer with the same id the data-attr
			// carries — see `entityIdToUriSegment` rationale.
			expect(element.getAttribute("href")).toBe("brainstorm://entity/ent%23with%2Fspecial%3Fchars");
			// Chrome: a 3-element card (icon span + title + subtitle).
			expect(element.querySelector("script, img, svg, iframe, object, embed")).toBeNull();
			const icon = element.children[0];
			const body = element.children[1];
			expect(icon?.getAttribute("aria-hidden")).toBe("true");
			expect(icon?.textContent).toBe("↪");
			expect(body?.children.length).toBe(2);
			expect(body?.children[0]?.textContent).toBe("My note");
		});
	});

	it("importDOM round-trips an exported anchor into an equivalent node", () => {
		// Build the export side, then feed it back through importDOM and
		// assert byte-equality on every persisted field.
		const e = editor();
		let html = "";
		e.update(
			() => {
				$getRoot().append(
					$createTransclusionNode("ent_alpha", "io.brainstorm.notes/Note/v1", "Origin doc"),
				);
			},
			{ discrete: true },
		);
		e.getEditorState().read(() => {
			const n = $getRoot().getFirstChild();
			if (!$isTransclusionNode(n)) throw new Error("expected transclusion");
			const { element } = n.exportDOM();
			if (!(element instanceof HTMLAnchorElement)) throw new Error("expected <a>");
			html = element.outerHTML;
		});
		const parsed = new DOMParser().parseFromString(html, "text/html");
		const anchor = parsed.querySelector("a");
		expect(anchor).not.toBeNull();
		if (!anchor) return;
		const target = editor();
		let node: ReturnType<typeof $getRoot> | null | undefined = null;
		target.update(
			() => {
				const map = TransclusionNode.importDOM();
				const handler = map?.a?.(anchor);
				expect(handler).not.toBeNull();
				if (!handler) return;
				const out = handler.conversion(anchor);
				if (!out) throw new Error("expected DOMConversionOutput");
				node = (Array.isArray(out.node) ? out.node[0] : out.node) as unknown as ReturnType<
					typeof $getRoot
				> | null;
			},
			{ discrete: true },
		);
		expect(node).not.toBeNull();
		if (!node || !$isTransclusionNode(node)) throw new Error("expected transclusion");
		// Read back through the editor — node keys + state live in the doc.
		target.getEditorState().read(() => {
			if (!$isTransclusionNode(node)) throw new Error("expected transclusion");
			expect(node.getEntityId()).toBe("ent_alpha");
			expect(node.getEntityType()).toBe("io.brainstorm.notes/Note/v1");
			expect(node.getLabel()).toBe("Origin doc");
		});
	});

	it("importDOM rejects an <a> whose flag value isn't the exact stamp", () => {
		// `data-lexical-transclusion="false"` or empty: NOT a transclusion.
		// A regular link with no flag: also not.
		const html =
			'<a href="brainstorm://entity/x" data-lexical-transclusion="false" data-entity-id="x">x</a>' +
			'<a href="brainstorm://entity/y" data-lexical-transclusion="" data-entity-id="y">y</a>' +
			'<a href="https://example.com" data-entity-id="z">z</a>';
		const parsed = new DOMParser().parseFromString(html, "text/html");
		const map = TransclusionNode.importDOM();
		for (const anchor of parsed.querySelectorAll("a")) {
			expect(map?.a?.(anchor)).toBeNull();
		}
	});

	it("importDOM rejects an <a> with the correct flag but empty entity id", () => {
		// A reference to nothing is not a reference (mirror of BlockEmbedNode
		// security fence).
		const html =
			'<a href="brainstorm://entity/" data-lexical-transclusion="true" data-entity-id="">x</a>';
		const parsed = new DOMParser().parseFromString(html, "text/html");
		const anchor = parsed.querySelector("a");
		expect(anchor).not.toBeNull();
		if (!anchor) return;
		const map = TransclusionNode.importDOM();
		const handler = map?.a?.(anchor);
		expect(handler).not.toBeNull();
		if (!handler) return;
		const out = handler.conversion(anchor);
		// `null` is also acceptable for the empty-id reject path — the
		// conversion can legitimately decline. We assert the resolved
		// node is null whether `out` is null OR carries `{node: null}`.
		const node = out ? (Array.isArray(out.node) ? (out.node[0] ?? null) : out.node) : null;
		expect(node).toBeNull();
	});
});
