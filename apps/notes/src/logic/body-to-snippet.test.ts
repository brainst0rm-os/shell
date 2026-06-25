// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { DEFAULT_SNIPPET_LENGTH, bodyToSnippet } from "./body-to-snippet";

function makeBody(text: string): Y.XmlText {
	const doc = new Y.Doc();
	const body = doc.get("root", Y.XmlText);
	body.insert(0, text);
	return body;
}

describe("bodyToSnippet", () => {
	it("returns an empty string for a never-bootstrapped (empty) body", () => {
		const doc = new Y.Doc();
		const body = doc.get("root", Y.XmlText);
		expect(bodyToSnippet(body)).toBe("");
	});

	it("returns trimmed plain text for a short body", () => {
		const body = makeBody("  hello world  ");
		expect(bodyToSnippet(body)).toBe("hello world");
	});

	it("collapses whitespace runs (newlines, tabs, multiple spaces) into single spaces", () => {
		const body = makeBody("alpha   beta\n\tgamma");
		expect(bodyToSnippet(body)).toBe("alpha beta gamma");
	});

	it("clips at the requested cap with a trailing ellipsis when the source exceeds it", () => {
		const body = makeBody("a".repeat(DEFAULT_SNIPPET_LENGTH + 50));
		const out = bodyToSnippet(body);
		expect(out.endsWith("…")).toBe(true);
		expect(out.length).toBe(DEFAULT_SNIPPET_LENGTH + 1);
	});

	it("does NOT append an ellipsis when the source fits exactly at the cap", () => {
		const body = makeBody("a".repeat(DEFAULT_SNIPPET_LENGTH));
		const out = bodyToSnippet(body);
		expect(out.endsWith("…")).toBe(false);
		expect(out.length).toBe(DEFAULT_SNIPPET_LENGTH);
	});

	it("honours a caller-supplied maxChars override", () => {
		const body = makeBody("hello world");
		expect(bodyToSnippet(body, 5)).toBe("hello…");
	});

	it("survives a Y.Doc round-trip (encodeStateAsUpdate → fresh doc) — same snippet", () => {
		const writer = new Y.Doc();
		const body = writer.get("root", Y.XmlText);
		body.insert(0, "fresh body for replica");
		const update = Y.encodeStateAsUpdate(writer);

		const reader = new Y.Doc();
		Y.applyUpdate(reader, update);
		const replicaBody = reader.get("root", Y.XmlText);

		expect(bodyToSnippet(replicaBody)).toBe(bodyToSnippet(body));
		expect(bodyToSnippet(replicaBody)).toBe("fresh body for replica");
	});

	it("skips block-embed Map / XmlElement markers (no [object Object] in snippet)", () => {
		// Reproduce the shape `@lexical/yjs` builds when persisting Lexical
		// blocks: the root XmlText embeds child XmlTexts (one per block);
		// each block embeds a Map marker (text node) followed by the actual
		// string content. Pre-walker, root.toString() leaked every Map +
		// XmlText embed as "[object Object]".
		const doc = new Y.Doc();
		const root = doc.get("root", Y.XmlText);
		const paragraph1 = new Y.XmlText();
		paragraph1.setAttribute("__type", "paragraph");
		const textMarker1 = new Y.Map();
		textMarker1.set("__type", "text");
		paragraph1.insertEmbed(0, textMarker1);
		paragraph1.insert(1, "Shipped 7 iterations.");
		root.insertEmbed(0, paragraph1);

		const paragraph2 = new Y.XmlText();
		paragraph2.setAttribute("__type", "paragraph");
		const textMarker2 = new Y.Map();
		textMarker2.set("__type", "text");
		paragraph2.insertEmbed(0, textMarker2);
		paragraph2.insert(1, "✅ 9.14.1 — App scaffold");
		root.insertEmbed(1, paragraph2);

		const out = bodyToSnippet(root);
		expect(out).not.toContain("[object Object]");
		expect(out).toContain("Shipped 7 iterations.");
		expect(out).toContain("9.14.1");
	});
});
