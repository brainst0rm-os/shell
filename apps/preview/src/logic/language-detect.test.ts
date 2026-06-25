import { describe, expect, it } from "vitest";
import { CodeLanguage, detectCodeLanguage, languageDisplayLabel } from "./language-detect";

describe("detectCodeLanguage — extension", () => {
	it("maps common extensions, case-insensitively, ignoring the directory", () => {
		expect(detectCodeLanguage({ path: "src/app.ts" })).toBe(CodeLanguage.TypeScript);
		expect(detectCodeLanguage({ path: "/a/b/Comp.TSX" })).toBe(CodeLanguage.TSX);
		expect(detectCodeLanguage({ path: "main.PY" })).toBe(CodeLanguage.Python);
		expect(detectCodeLanguage({ path: "deep\\win\\style.css" })).toBe(CodeLanguage.CSS);
	});

	it("special filenames win over their extension", () => {
		expect(detectCodeLanguage({ path: "x/Dockerfile" })).toBe(CodeLanguage.Dockerfile);
		expect(detectCodeLanguage({ path: "tsconfig.json" })).toBe(CodeLanguage.JSONC);
		expect(detectCodeLanguage({ path: "Makefile" })).toBe(CodeLanguage.Shell);
	});

	it("a leading-dot dotfile has no extension → falls through to plaintext", () => {
		expect(detectCodeLanguage({ path: ".gitignore" })).toBe(CodeLanguage.PlainText);
	});
});

describe("detectCodeLanguage — MIME + shebang fallback", () => {
	it("uses MIME when the path gives nothing", () => {
		expect(detectCodeLanguage({ mime: "application/json" })).toBe(CodeLanguage.JSON);
		expect(detectCodeLanguage({ mime: "text/x-python; charset=utf-8" })).toBe(CodeLanguage.Python);
	});

	it("reads a shebang interpreter (env-style + absolute path)", () => {
		expect(detectCodeLanguage({ firstLine: "#!/usr/bin/env python3" })).toBe(CodeLanguage.Python);
		expect(detectCodeLanguage({ firstLine: "#!/bin/bash" })).toBe(CodeLanguage.Shell);
		expect(detectCodeLanguage({ firstLine: "#!/usr/bin/env node" })).toBe(CodeLanguage.JavaScript);
		expect(detectCodeLanguage({ firstLine: "#!/usr/bin/env deno run" })).toBe(
			CodeLanguage.TypeScript,
		);
	});

	it("precedence is extension → mime → shebang", () => {
		// .ts extension beats a misleading python mime + bash shebang.
		expect(
			detectCodeLanguage({ path: "x.ts", mime: "text/x-python", firstLine: "#!/bin/bash" }),
		).toBe(CodeLanguage.TypeScript);
	});

	it("every signal empty / unknown → PlainText (never throws)", () => {
		expect(detectCodeLanguage({})).toBe(CodeLanguage.PlainText);
		expect(detectCodeLanguage({ path: "data.bin", mime: "application/octet-stream" })).toBe(
			CodeLanguage.PlainText,
		);
		expect(detectCodeLanguage({ firstLine: "not a shebang" })).toBe(CodeLanguage.PlainText);
	});
});

describe("languageDisplayLabel", () => {
	it("returns a proper-cased label for every enum member", () => {
		for (const lang of Object.values(CodeLanguage)) {
			const label = languageDisplayLabel(lang);
			expect(typeof label).toBe("string");
			expect(label.length).toBeGreaterThan(0);
		}
		expect(languageDisplayLabel(CodeLanguage.TypeScript)).toBe("TypeScript");
		expect(languageDisplayLabel(CodeLanguage.PlainText)).toBe("Plain text");
	});
});
