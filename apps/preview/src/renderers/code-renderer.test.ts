// @vitest-environment jsdom
/**
 * Code renderer — gutter + non-wrapping monospaced body, language
 * auto-detected, content written as text only (never innerHTML).
 */

import { describe, expect, it } from "vitest";
import type { PreviewFileInfo, PreviewSource } from "../types/preview-module";
import { codeRenderer, linesOf } from "./code-renderer";

const FILE: PreviewFileInfo = {
	name: "main.ts",
	mime: "text/x-typescript",
	sizeBytes: 64,
	modifiedAt: Date.now(),
};

function bytes(text: string, mime = "text/x-typescript"): PreviewSource {
	return { kind: "bytes", bytes: new TextEncoder().encode(text), mime };
}

describe("linesOf", () => {
	it("treats an empty file as a single empty line (gutter still shows 1)", () => {
		expect(linesOf("")).toEqual([""]);
	});
	it("drops the phantom line a trailing newline adds", () => {
		expect(linesOf("a\nb\n")).toEqual(["a", "b"]);
		expect(linesOf("a\nb")).toEqual(["a", "b"]);
	});
});

describe("codeRenderer", () => {
	it("mounts a gutter with one number per line aligned to the code body", async () => {
		const host = document.createElement("div");
		document.body.appendChild(host);
		const instance = await codeRenderer.mount({
			source: bytes("const a = 1;\nconst b = 2;\nexport { a, b };"),
			file: FILE,
			host,
		});
		const linenos = host.querySelectorAll(".preview-code__lineno");
		expect(linenos.length).toBe(3);
		expect([...linenos].map((n) => n.textContent)).toEqual(["1", "2", "3"]);
		expect(host.querySelector(".preview-code__body code")?.textContent).toBe(
			"const a = 1;\nconst b = 2;\nexport { a, b };",
		);
		instance.dispose();
		expect(host.children.length).toBe(0);
	});

	it("renders hostile source as inert text — no live elements", async () => {
		const host = document.createElement("div");
		document.body.appendChild(host);
		await codeRenderer.mount({
			source: bytes("<script>alert(1)</script>", "text/html"),
			file: { ...FILE, name: "x.html", mime: "text/html" },
			host,
		});
		expect(host.querySelectorAll("script").length).toBe(0);
		expect(host.textContent).toContain("<script>");
	});

	it("gutter is aria-hidden (decorative — the code is the content)", async () => {
		const host = document.createElement("div");
		document.body.appendChild(host);
		await codeRenderer.mount({ source: bytes("x"), file: FILE, host });
		expect(host.querySelector(".preview-code__gutter")?.getAttribute("aria-hidden")).toBe("true");
	});

	it("extractMetadata reports detected language + line + character counts", async () => {
		const meta = await codeRenderer.extractMetadata?.(
			bytes("def f():\n    return 1\n", "text/x-python"),
		);
		expect(meta).toEqual({ language: "Python", lines: "2", characters: "22" });
	});

	it("extractMetadata language falls back to Plain text for an unknown source", async () => {
		const meta = await codeRenderer.extractMetadata?.(
			bytes("just words", "application/octet-stream"),
		);
		expect(meta?.language).toBe("Plain text");
	});
});
