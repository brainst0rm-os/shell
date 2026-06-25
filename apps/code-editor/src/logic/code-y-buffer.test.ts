/**
 * @vitest-environment jsdom
 *
 * Y.Text ↔ textarea binding.
 *
 * Exercised against jsdom textareas + bare `Y.Doc`s — the binding has
 * to work without any IPC / resolver glue (the resolver simply hooks
 * the `Y.Doc.on("update")` channel; the in-textarea behaviour is the
 * same with or without a transport).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
	LOCAL_BUFFER_ORIGIN,
	bindCodeBuffer,
	diffStrings,
	getCodeBuffer,
	seedCodeBuffer,
} from "./code-y-buffer";

describe("diffStrings", () => {
	it("returns a no-op for equal strings", () => {
		expect(diffStrings("abc", "abc")).toEqual({ start: 0, removed: 0, added: "" });
	});

	it("captures a pure append", () => {
		expect(diffStrings("foo", "foobar")).toEqual({ start: 3, removed: 0, added: "bar" });
	});

	it("captures a pure deletion at the head", () => {
		expect(diffStrings("foobar", "bar")).toEqual({ start: 0, removed: 3, added: "" });
	});

	it("captures a middle replacement", () => {
		expect(diffStrings("hello world", "hello brave world")).toEqual({
			start: 6,
			removed: 0,
			added: "brave ",
		});
	});

	it("captures an empty-to-content insert", () => {
		expect(diffStrings("", "x")).toEqual({ start: 0, removed: 0, added: "x" });
	});

	it("captures a content-to-empty deletion", () => {
		expect(diffStrings("xy", "")).toEqual({ start: 0, removed: 2, added: "" });
	});
});

describe("seedCodeBuffer", () => {
	it("seeds an empty buffer with the snapshot", () => {
		const doc = new Y.Doc();
		const text = getCodeBuffer(doc);
		seedCodeBuffer(text, "console.log(1);");
		expect(text.toString()).toBe("console.log(1);");
	});

	it("is a no-op when the buffer already matches", () => {
		const doc = new Y.Doc();
		const text = getCodeBuffer(doc);
		text.insert(0, "x");
		let updates = 0;
		doc.on("update", () => {
			updates++;
		});
		seedCodeBuffer(text, "x");
		expect(updates).toBe(0);
	});

	it("replaces existing content when different", () => {
		const doc = new Y.Doc();
		const text = getCodeBuffer(doc);
		text.insert(0, "old");
		seedCodeBuffer(text, "new content");
		expect(text.toString()).toBe("new content");
	});
});

describe("bindCodeBuffer", () => {
	let textarea: HTMLTextAreaElement;
	let doc: Y.Doc;
	let text: Y.Text;

	beforeEach(() => {
		textarea = document.createElement("textarea");
		document.body.appendChild(textarea);
		doc = new Y.Doc();
		text = getCodeBuffer(doc);
	});
	afterEach(() => {
		textarea.remove();
	});

	it("initialises the textarea from the Y.Text", () => {
		seedCodeBuffer(text, "hi");
		bindCodeBuffer({ buffer: text, textarea, onChange: () => {} });
		expect(textarea.value).toBe("hi");
	});

	it("propagates a local edit into the Y.Text as a minimal patch", () => {
		seedCodeBuffer(text, "hello");
		const changes: string[] = [];
		bindCodeBuffer({
			buffer: text,
			textarea,
			onChange: (c) => changes.push(c),
		});
		textarea.value = "hello world";
		textarea.dispatchEvent(new Event("input"));
		expect(text.toString()).toBe("hello world");
		expect(changes).toEqual(["hello world"]);
	});

	it("local edits are tagged with LOCAL_BUFFER_ORIGIN", () => {
		bindCodeBuffer({ buffer: text, textarea, onChange: () => {} });
		const origins: unknown[] = [];
		doc.on("afterTransaction", (tx) => {
			origins.push(tx.origin);
		});
		textarea.value = "x";
		textarea.dispatchEvent(new Event("input"));
		expect(origins).toContain(LOCAL_BUFFER_ORIGIN);
	});

	it("propagates a remote Y.Text update into the textarea", () => {
		bindCodeBuffer({ buffer: text, textarea, onChange: () => {} });
		doc.transact(() => text.insert(0, "remote"), "test-remote");
		expect(textarea.value).toBe("remote");
	});

	it("does NOT re-fire local edits as remote on echo", () => {
		bindCodeBuffer({ buffer: text, textarea, onChange: () => {} });
		textarea.value = "abc";
		textarea.dispatchEvent(new Event("input"));
		expect(textarea.value).toBe("abc");
		expect(text.toString()).toBe("abc");
	});

	it("dispose() detaches both observers", () => {
		const handle = bindCodeBuffer({ buffer: text, textarea, onChange: () => {} });
		handle.dispose();
		textarea.value = "x";
		textarea.dispatchEvent(new Event("input"));
		expect(text.toString()).toBe("");
		doc.transact(() => text.insert(0, "y"), "test");
		expect(textarea.value).toBe("x");
	});

	it("clamps the caret on remote shrink", () => {
		seedCodeBuffer(text, "hello world");
		textarea.focus();
		textarea.setSelectionRange(8, 8);
		bindCodeBuffer({ buffer: text, textarea, onChange: () => {} });
		doc.transact(() => text.delete(5, 6), "test");
		expect(textarea.value).toBe("hello");
		expect(textarea.selectionStart).toBe(5);
	});
});
