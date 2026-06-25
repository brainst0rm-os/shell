// @vitest-environment jsdom
/**
 * Markdown renderer — mount produces the expected DOM tree shape from a
 * bytes source. The XSS-safety claim is owned by the underlying
 * `markdown-to-dom.test.ts`; this file only checks the integration.
 */

import { describe, expect, it } from "vitest";
import type { PreviewFileInfo, PreviewSource } from "../types/preview-module";
import { markdownRenderer } from "./markdown-renderer";

const FILE: PreviewFileInfo = {
	name: "demo.md",
	mime: "text/markdown",
	sizeBytes: 32,
	modifiedAt: Date.now(),
};

function bytes(text: string): PreviewSource {
	return { kind: "bytes", bytes: new TextEncoder().encode(text), mime: "text/markdown" };
}

describe("markdownRenderer", () => {
	it("renders a heading + paragraph + list into the host", async () => {
		const host = document.createElement("div");
		document.body.appendChild(host);
		const instance = await markdownRenderer.mount({
			source: bytes("# Title\n\nparagraph here\n\n- a\n- b"),
			file: FILE,
			host,
		});
		expect(host.querySelectorAll("h1").length).toBe(1);
		expect(host.querySelectorAll("p").length).toBe(1);
		expect(host.querySelectorAll("ul > li").length).toBe(2);
		instance.dispose();
		expect(host.children.length).toBe(0);
	});

	it("extractMetadata reports a word count", async () => {
		const meta = await markdownRenderer.extractMetadata?.(bytes("# Hi\n\nthree more words"));
		expect(meta).toEqual({ words: "4" });
	});
});
