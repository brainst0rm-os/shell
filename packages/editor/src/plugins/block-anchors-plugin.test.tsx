/**
 * Durable block-anchor lifecycle (B11.13) on a headless Lexical editor:
 * mint → persist → follow edits/splits/moves → re-resolve in a fresh
 * "session" (new editor, new NodeKeys, same store) → degrade when gone.
 */

import { $createParagraphNode, $createTextNode, $getNodeByKey, $getRoot } from "lexical";
import type { LexicalEditor, NodeKey } from "lexical";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMapBlockAnchorStore } from "../block-anchors";
import { createBrainstormHeadlessEditor } from "../headless";
import {
	getBlockAnchorsController,
	mountBlockAnchors,
	revealBlockByKey,
	startAnchorReveal,
} from "./block-anchors-plugin";

function makeSession(map: Map<string, unknown>): {
	editor: LexicalEditor;
	dispose: () => void;
} {
	const editor = createBrainstormHeadlessEditor();
	const dispose = mountBlockAnchors(editor, createMapBlockAnchorStore(map));
	return { editor, dispose };
}

function addParagraph(editor: LexicalEditor, text: string): NodeKey {
	let key = "" as NodeKey;
	editor.update(
		() => {
			const p = $createParagraphNode();
			p.append($createTextNode(text));
			$getRoot().append(p);
			key = p.getKey();
		},
		{ discrete: true },
	);
	return key;
}

function controllerOf(editor: LexicalEditor) {
	const controller = getBlockAnchorsController(editor);
	if (!controller) throw new Error("controller not mounted");
	return controller;
}

let disposers: (() => void)[] = [];

beforeEach(() => {
	disposers = [];
});

afterEach(() => {
	for (const dispose of disposers) dispose();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

function session(map: Map<string, unknown>) {
	const s = makeSession(map);
	disposers.push(s.dispose);
	return s;
}

describe("mint (ensureAnchorId)", () => {
	it("mints a durable id distinct from the session key and persists the fingerprint", () => {
		const map = new Map<string, unknown>();
		const { editor } = session(map);
		const key = addParagraph(editor, "First paragraph body");

		const anchorId = controllerOf(editor).ensureAnchorId(key);
		expect(anchorId).toBeTruthy();
		expect(anchorId).not.toBe(key);
		expect(map.get(anchorId as string)).toEqual({
			type: "paragraph",
			text: "First paragraph body",
			index: 0,
		});
	});

	it("returns the same id for repeat copies of the same block", () => {
		const map = new Map<string, unknown>();
		const { editor } = session(map);
		const key = addParagraph(editor, "Stable block");
		const c = controllerOf(editor);
		expect(c.ensureAnchorId(key)).toBe(c.ensureAnchorId(key));
		expect(map.size).toBe(1);
	});

	it("returns null for a key that is not a live block", () => {
		const map = new Map<string, unknown>();
		const { editor } = session(map);
		addParagraph(editor, "exists");
		expect(controllerOf(editor).ensureAnchorId("no-such-key")).toBeNull();
	});

	it("reuses a persisted anchor from a previous session when the fingerprint is identical", () => {
		const map = new Map<string, unknown>();
		const s1 = session(map);
		const k1 = addParagraph(s1.editor, "Cross-session block");
		const id1 = controllerOf(s1.editor).ensureAnchorId(k1);

		const s2 = session(map);
		const k2 = addParagraph(s2.editor, "Cross-session block");
		const id2 = controllerOf(s2.editor).ensureAnchorId(k2);

		expect(id2).toBe(id1);
		expect(map.size).toBe(1);
	});
});

describe("track (fingerprint follows the session's edits)", () => {
	it("refreshes the persisted text after an edit", () => {
		const map = new Map<string, unknown>();
		const { editor } = session(map);
		const key = addParagraph(editor, "Before the edit");
		const id = controllerOf(editor).ensureAnchorId(key) as string;

		editor.update(
			() => {
				const p = $getNodeByKey(key) as ReturnType<typeof $createParagraphNode> | null;
				if (!p) return;
				p.clear();
				p.append($createTextNode("After the edit"));
			},
			{ discrete: true },
		);
		controllerOf(editor).refreshNow();

		expect(map.get(id)).toMatchObject({ text: "After the edit" });
	});

	it("keeps the anchor on the first half of a split block", () => {
		const map = new Map<string, unknown>();
		const { editor } = session(map);
		const key = addParagraph(editor, "First half of the block second half of the block");
		const id = controllerOf(editor).ensureAnchorId(key) as string;

		// Simulate an Enter-split: the original node keeps the first half,
		// a new sibling carries the rest (Lexical's split keeps the key on
		// the original).
		editor.update(
			() => {
				const p = $getNodeByKey(key) as ReturnType<typeof $createParagraphNode> | null;
				if (!p) return;
				p.clear();
				p.append($createTextNode("First half of the block"));
				const rest = $createParagraphNode();
				rest.append($createTextNode("second half of the block"));
				p.insertAfter(rest);
			},
			{ discrete: true },
		);
		controllerOf(editor).refreshNow();

		expect(map.get(id)).toMatchObject({ text: "First half of the block" });
		expect(controllerOf(editor).resolveBlockKey(id)).toBe(key);
	});

	it("updates the persisted index after a move", () => {
		const map = new Map<string, unknown>();
		const { editor } = session(map);
		addParagraph(editor, "Block A");
		addParagraph(editor, "Block B");
		const keyC = addParagraph(editor, "Block C");
		const id = controllerOf(editor).ensureAnchorId(keyC) as string;
		expect(map.get(id)).toMatchObject({ index: 2 });

		editor.update(
			() => {
				const c = $getNodeByKey(keyC);
				const first = $getRoot().getFirstChild();
				if (c && first && first.getKey() !== keyC) first.insertBefore(c);
			},
			{ discrete: true },
		);
		controllerOf(editor).refreshNow();

		expect(map.get(id)).toMatchObject({ index: 0 });
	});

	it("debounces the refresh off the update listener (no immediate write)", () => {
		vi.useFakeTimers();
		const map = new Map<string, unknown>();
		const { editor } = session(map);
		const key = addParagraph(editor, "Debounce me");
		const id = controllerOf(editor).ensureAnchorId(key) as string;

		editor.update(
			() => {
				const p = $getNodeByKey(key) as ReturnType<typeof $createParagraphNode> | null;
				p?.append($createTextNode(" plus more"));
			},
			{ discrete: true },
		);
		expect(map.get(id)).toMatchObject({ text: "Debounce me" });
		vi.advanceTimersByTime(700);
		expect(map.get(id)).toMatchObject({ text: "Debounce me plus more" });
	});
});

describe("resolve (inbound #block-<id>)", () => {
	it("re-resolves in a fresh session whose NodeKeys are all new", () => {
		const map = new Map<string, unknown>();
		const s1 = session(map);
		addParagraph(s1.editor, "Intro block");
		const target1 = addParagraph(s1.editor, "The linked block content");
		const id = controllerOf(s1.editor).ensureAnchorId(target1) as string;
		s1.dispose();

		const s2 = session(map);
		addParagraph(s2.editor, "Intro block");
		const target2 = addParagraph(s2.editor, "The linked block content");

		expect(controllerOf(s2.editor).resolveBlockKey(id)).toBe(target2);
	});

	it("re-resolves an edited block via prefix overlap and self-heals the entry", () => {
		const map = new Map<string, unknown>();
		const s1 = session(map);
		const k1 = addParagraph(s1.editor, "The linked block content");
		const id = controllerOf(s1.editor).ensureAnchorId(k1) as string;
		s1.dispose();

		// "Another device" extended the block since the fingerprint was taken.
		const s2 = session(map);
		const k2 = addParagraph(s2.editor, "The linked block content grew some extra words");

		expect(controllerOf(s2.editor).resolveBlockKey(id)).toBe(k2);
		expect(map.get(id)).toMatchObject({
			text: "The linked block content grew some extra words",
		});
	});

	it("degrades to null when the block is gone", () => {
		const map = new Map<string, unknown>();
		const s1 = session(map);
		const k1 = addParagraph(s1.editor, "Doomed block with unique text");
		const id = controllerOf(s1.editor).ensureAnchorId(k1) as string;
		s1.dispose();

		const s2 = session(map);
		addParagraph(s2.editor, "Entirely different content now");

		expect(controllerOf(s2.editor).resolveBlockKey(id)).toBeNull();
	});

	it("drops a dead session binding, then re-resolves by fingerprint", () => {
		const map = new Map<string, unknown>();
		const { editor } = session(map);
		const key = addParagraph(editor, "Recreated block body");
		const id = controllerOf(editor).ensureAnchorId(key) as string;

		editor.update(
			() => {
				$getNodeByKey(key)?.remove();
			},
			{ discrete: true },
		);
		const recreated = addParagraph(editor, "Recreated block body");

		expect(controllerOf(editor).resolveBlockKey(id)).toBe(recreated);
	});

	it("falls back to a live NodeKey for legacy (pre-durable) links", () => {
		const map = new Map<string, unknown>();
		const { editor } = session(map);
		const key = addParagraph(editor, "Legacy-linked block");
		expect(controllerOf(editor).resolveBlockKey(key)).toBe(key);
	});

	it("returns null for an unknown id that is also not a live key", () => {
		const map = new Map<string, unknown>();
		const { editor } = session(map);
		addParagraph(editor, "content");
		expect(controllerOf(editor).resolveBlockKey("never-minted")).toBeNull();
	});
});

describe("revealBlockByKey", () => {
	function fakeElement() {
		return {
			scrollIntoView: vi.fn(),
			classList: { add: vi.fn(), remove: vi.fn() },
			offsetWidth: 0,
		} as unknown as HTMLElement;
	}

	it("scrolls + flashes when the block has DOM", () => {
		vi.useFakeTimers();
		const map = new Map<string, unknown>();
		const { editor } = session(map);
		const key = addParagraph(editor, "Reveal me");
		const el = fakeElement();
		vi.spyOn(editor, "getElementByKey").mockReturnValue(el);

		expect(revealBlockByKey(editor, key)).toBe(true);
		expect(el.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
		expect(el.classList.add).toHaveBeenCalledWith("bs-block-anchor-flash");
		vi.advanceTimersByTime(2_100);
		expect(el.classList.remove).toHaveBeenLastCalledWith("bs-block-anchor-flash");
	});

	it("returns false when the block has no DOM yet", () => {
		const map = new Map<string, unknown>();
		const { editor } = session(map);
		const key = addParagraph(editor, "No DOM");
		expect(revealBlockByKey(editor, key)).toBe(false);
	});
});

describe("startAnchorReveal", () => {
	function fakeElement() {
		return {
			scrollIntoView: vi.fn(),
			classList: { add: vi.fn(), remove: vi.fn() },
			offsetWidth: 0,
		} as unknown as HTMLElement;
	}

	it("reveals immediately when the anchor already resolves", () => {
		const map = new Map<string, unknown>();
		const { editor } = session(map);
		const key = addParagraph(editor, "Already here");
		const id = controllerOf(editor).ensureAnchorId(key) as string;
		vi.spyOn(editor, "getElementByKey").mockReturnValue(fakeElement());

		const done = vi.fn();
		startAnchorReveal(editor, id, done);
		expect(done).toHaveBeenCalledWith(true);
	});

	it("retries across commits while the doc hydrates, then reveals", () => {
		const map = new Map<string, unknown>();
		map.set("late-anchor", { type: "paragraph", text: "Hydrated later", index: 0 });
		const { editor } = session(map);
		vi.spyOn(editor, "getElementByKey").mockReturnValue(fakeElement());

		const done = vi.fn();
		startAnchorReveal(editor, "late-anchor", done);
		expect(done).not.toHaveBeenCalled();

		addParagraph(editor, "Hydrated later");
		expect(done).toHaveBeenCalledWith(true);
	});

	it("reports failure after the timeout when the anchor never resolves", () => {
		vi.useFakeTimers();
		const map = new Map<string, unknown>();
		const { editor } = session(map);
		addParagraph(editor, "content");

		const done = vi.fn();
		startAnchorReveal(editor, "never-resolves", done);
		vi.advanceTimersByTime(8_100);
		expect(done).toHaveBeenCalledWith(false);
	});

	it("a cancelled reveal reports nothing", () => {
		vi.useFakeTimers();
		const map = new Map<string, unknown>();
		const { editor } = session(map);
		const done = vi.fn();
		const cancel = startAnchorReveal(editor, "pending", done);
		cancel();
		vi.advanceTimersByTime(10_000);
		addParagraph(editor, "anything");
		expect(done).not.toHaveBeenCalled();
	});
});
