// @vitest-environment jsdom
import { $createHeadingNode } from "@lexical/rich-text";
import {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	type LexicalEditor,
	createEditor,
} from "lexical";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BLOCK_ID_ATTR } from "./block-id";
import {
	BlockKind,
	ESTIMATED_HEADING_H1_PX,
	type HeightCache,
	createHeightCache,
} from "./height-cache";
import { BASELINE_NODES } from "./nodes";
import { mountVirtualization } from "./virtualize-plugin";

function must<T>(v: T | null | undefined, m: string): T {
	if (v == null) throw new Error(m);
	return v;
}

const BLOCK_CLASS = "bs-editor__block";

/** Real (DOM-backed) editor under jsdom: `createEditor` + `setRootElement`
 *  so `getElementByKey` returns the rendered HTMLElement. */
function mountEditor(): { editor: LexicalEditor; rootEl: HTMLElement } {
	const editor = createEditor({
		namespace: "test-virtualize-plugin",
		nodes: [...BASELINE_NODES],
		onError: (e) => {
			throw e;
		},
	});
	const rootEl = document.createElement("div");
	rootEl.contentEditable = "true";
	document.body.appendChild(rootEl);
	editor.setRootElement(rootEl);
	return { editor, rootEl };
}

function update(editor: LexicalEditor, fn: () => void): void {
	editor.update(fn, { discrete: true });
}

function blockElementsIn(rootEl: HTMLElement): HTMLElement[] {
	return Array.from(rootEl.querySelectorAll(`[${BLOCK_ID_ATTR}]`)) as HTMLElement[];
}

describe("mountVirtualization", () => {
	let editor: LexicalEditor;
	let rootEl: HTMLElement;

	beforeEach(() => {
		const mounted = mountEditor();
		editor = mounted.editor;
		rootEl = mounted.rootEl;
	});
	afterEach(() => {
		rootEl.remove();
	});

	it("stamps `data-bs-block` on every top-level block element after mount", () => {
		update(editor, () => {
			const root = $getRoot();
			root.clear();
			const p1 = $createParagraphNode();
			p1.append($createTextNode("first"));
			const p2 = $createParagraphNode();
			p2.append($createTextNode("second"));
			const h = $createHeadingNode("h1");
			h.append($createTextNode("title"));
			root.append(p1, p2, h);
		});

		const dispose = mountVirtualization(editor);
		const stamped = blockElementsIn(rootEl);
		expect(stamped.length).toBe(3);
		for (const el of stamped) {
			expect(el.getAttribute(BLOCK_ID_ATTR)).not.toBeNull();
			expect(el.getAttribute(BLOCK_ID_ATTR)).not.toBe("");
		}
		dispose();
	});

	it("adds the `bs-editor__block` class to every stamped element", () => {
		update(editor, () => {
			const root = $getRoot();
			root.clear();
			const p = $createParagraphNode();
			p.append($createTextNode("x"));
			root.append(p);
		});
		const dispose = mountVirtualization(editor);
		for (const el of blockElementsIn(rootEl)) {
			expect(el.classList.contains(BLOCK_CLASS)).toBe(true);
		}
		dispose();
	});

	it("sets the `--bs-block-intrinsic-h` custom property on every stamped element", () => {
		update(editor, () => {
			const root = $getRoot();
			root.clear();
			const p = $createParagraphNode();
			p.append($createTextNode("x"));
			root.append(p);
		});
		const dispose = mountVirtualization(editor);
		for (const el of blockElementsIn(rootEl)) {
			const v = el.style.getPropertyValue("--bs-block-intrinsic-h");
			expect(v).not.toBe("");
			expect(v.endsWith("px")).toBe(true);
		}
		dispose();
	});

	it("uses an injected cache's measured value (over the typed estimate) when present", () => {
		// Use a custom cache pre-seeded by capturing the key the plugin will
		// stamp; we register a measurement *before* the plugin reads it by
		// using a wrapper cache that returns a fixed value for `get`.
		const FIXED_MEASURED_PX = 321;
		const baseline = createHeightCache();
		const cache: HeightCache = {
			get: () => FIXED_MEASURED_PX,
			observe: (id, el) => baseline.observe(id, el),
			estimate: (kind, hint) => baseline.estimate(kind, hint),
			size: () => baseline.size(),
			dispose: () => baseline.dispose(),
		};

		update(editor, () => {
			const root = $getRoot();
			root.clear();
			const h = $createHeadingNode("h1");
			h.append($createTextNode("Title"));
			root.append(h);
		});
		const dispose = mountVirtualization(editor, cache);
		const [el] = blockElementsIn(rootEl);
		expect(el).toBeDefined();
		expect(must(el, "el").style.getPropertyValue("--bs-block-intrinsic-h")).toBe(
			`${FIXED_MEASURED_PX}px`,
		);
		dispose();
	});

	it("falls back to the typed estimate when the cache has no measurement", () => {
		update(editor, () => {
			const root = $getRoot();
			root.clear();
			const h = $createHeadingNode("h1");
			h.append($createTextNode("Title"));
			root.append(h);
		});

		// Use a cache that never returns anything for `get`.
		const baseline = createHeightCache();
		const cache: HeightCache = {
			get: () => undefined,
			observe: (id, el) => baseline.observe(id, el),
			estimate: (kind, hint) => baseline.estimate(kind, hint),
			size: () => baseline.size(),
			dispose: () => baseline.dispose(),
		};

		const dispose = mountVirtualization(editor, cache);
		const [el] = blockElementsIn(rootEl);
		expect(el).toBeDefined();
		// HeadingH1 default estimate must drive the reserved height.
		expect(must(el, "el").style.getPropertyValue("--bs-block-intrinsic-h")).toBe(
			`${ESTIMATED_HEADING_H1_PX}px`,
		);
		dispose();
	});

	it("stamps newly-added blocks after a subsequent editor update", () => {
		update(editor, () => {
			const root = $getRoot();
			root.clear();
			const p = $createParagraphNode();
			p.append($createTextNode("one"));
			root.append(p);
		});
		const dispose = mountVirtualization(editor);
		expect(blockElementsIn(rootEl).length).toBe(1);

		update(editor, () => {
			const root = $getRoot();
			const p = $createParagraphNode();
			p.append($createTextNode("two"));
			root.append(p);
		});

		const after = blockElementsIn(rootEl);
		expect(after.length).toBe(2);
		for (const el of after) {
			expect(el.classList.contains(BLOCK_CLASS)).toBe(true);
			expect(el.getAttribute(BLOCK_ID_ATTR)).not.toBeNull();
		}
		dispose();
	});

	it("fires the per-block disposer when a block is removed in a subsequent update", () => {
		// Wrap the cache so we can observe disposer invocations per id.
		const baseline = createHeightCache();
		const disposeCalls: string[] = [];
		const cache: HeightCache = {
			get: (id) => baseline.get(id),
			observe: (id, el) => {
				const dispose = baseline.observe(id, el);
				return () => {
					disposeCalls.push(id);
					dispose();
				};
			},
			estimate: (kind, hint) => baseline.estimate(kind, hint),
			size: () => baseline.size(),
			dispose: () => baseline.dispose(),
		};

		// Two paragraphs; remember the keys.
		let key1 = "";
		let key2 = "";
		update(editor, () => {
			const root = $getRoot();
			root.clear();
			const p1 = $createParagraphNode();
			p1.append($createTextNode("a"));
			const p2 = $createParagraphNode();
			p2.append($createTextNode("b"));
			root.append(p1, p2);
			key1 = p1.getKey();
			key2 = p2.getKey();
		});
		const dispose = mountVirtualization(editor, cache);
		expect(disposeCalls).toEqual([]);

		// Remove p2 — the plugin should fire its disposer.
		update(editor, () => {
			const root = $getRoot();
			const children = root.getChildren();
			const last = children[children.length - 1];
			if (last) last.remove();
		});

		expect(disposeCalls).toContain(key2);
		expect(disposeCalls).not.toContain(key1);
		dispose();
	});

	it("the function returned by `mountVirtualization` removes all observers + disposes the auto-created cache", () => {
		update(editor, () => {
			const root = $getRoot();
			root.clear();
			const p = $createParagraphNode();
			p.append($createTextNode("x"));
			root.append(p);
		});

		// Path A: auto-created cache → `dispose()` should be called.
		// We can't easily observe that without injecting, but we can prove the
		// observer disposer map is cleared on `dispose()` by checking that a
		// subsequent edit doesn't re-stamp (because the update listener is
		// unregistered).
		const dispose = mountVirtualization(editor);
		expect(blockElementsIn(rootEl).length).toBe(1);
		dispose();

		// Strip the attribute manually + re-edit → since the listener was
		// removed, the plugin no longer re-stamps.
		for (const el of blockElementsIn(rootEl)) {
			el.removeAttribute(BLOCK_ID_ATTR);
			el.classList.remove(BLOCK_CLASS);
		}
		update(editor, () => {
			const root = $getRoot();
			const p = $createParagraphNode();
			p.append($createTextNode("y"));
			root.append(p);
		});
		// No more stamping after dispose — the elements stay un-marked.
		expect(blockElementsIn(rootEl).length).toBe(0);
	});

	it("does not dispose an INJECTED cache when the plugin's lifecycle ends", () => {
		let disposed = false;
		const baseline = createHeightCache();
		const cache: HeightCache = {
			get: (id) => baseline.get(id),
			observe: (id, el) => baseline.observe(id, el),
			estimate: (kind, hint) => baseline.estimate(kind, hint),
			size: () => baseline.size(),
			dispose: () => {
				disposed = true;
				baseline.dispose();
			},
		};
		update(editor, () => {
			const root = $getRoot();
			root.clear();
			const p = $createParagraphNode();
			p.append($createTextNode("x"));
			root.append(p);
		});
		const dispose = mountVirtualization(editor, cache);
		dispose();
		expect(disposed).toBe(false);
	});
});

// keep an unused-symbol reference so `BlockKind` import isn't pruned (we use
// `ESTIMATED_HEADING_H1_PX` to assert against the H1 estimate path).
void BlockKind;
