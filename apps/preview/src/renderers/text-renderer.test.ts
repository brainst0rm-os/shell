// @vitest-environment jsdom
/**
 * Text renderer — mounts a <pre><code> block from a bytes source, never
 * sets innerHTML, and surfaces line + character counts via extractMetadata.
 */

import { describe, expect, it } from "vitest";
import type { PreviewFileInfo, PreviewSource } from "../types/preview-module";
import { textRenderer } from "./text-renderer";

const FILE: PreviewFileInfo = {
	name: "demo.txt",
	mime: "text/plain",
	sizeBytes: 32,
	modifiedAt: Date.now(),
};

function bytes(text: string): PreviewSource {
	return { kind: "bytes", bytes: new TextEncoder().encode(text), mime: "text/plain" };
}

describe("textRenderer", () => {
	it("mounts a <pre><code> block whose textContent equals the decoded source", async () => {
		const host = document.createElement("div");
		document.body.appendChild(host);
		const instance = await textRenderer.mount({ source: bytes("hello\nworld"), file: FILE, host });
		const code = host.querySelector("pre code");
		expect(code?.textContent).toBe("hello\nworld");
		instance.dispose();
		expect(host.children.length).toBe(0);
	});

	it("treats HTML-looking text as text — no live elements ever appear in the tree", async () => {
		const host = document.createElement("div");
		document.body.appendChild(host);
		await textRenderer.mount({ source: bytes("<script>alert(1)</script>"), file: FILE, host });
		expect(host.querySelectorAll("script").length).toBe(0);
		expect(host.textContent).toContain("<script>");
	});

	it("extractMetadata reports a line + character count", async () => {
		const meta = await textRenderer.extractMetadata?.(bytes("a\nb\nc"));
		expect(meta).toEqual({ lines: "3", characters: "5" });
	});

	it("extractMetadata does not double-count a trailing newline", async () => {
		const meta = await textRenderer.extractMetadata?.(bytes("a\nb\n"));
		expect(meta?.lines).toBe("2");
	});
});
