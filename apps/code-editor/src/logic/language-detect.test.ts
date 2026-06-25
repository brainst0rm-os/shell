import { describe, expect, it } from "vitest";
import { LanguageKey } from "../types/code-file";
import {
	languageForExtension,
	languageForMime,
	languageForShebang,
	resolveLanguage,
} from "./language-detect";

describe("languageForExtension", () => {
	it("recognises every common source extension", () => {
		expect(languageForExtension("foo.ts")).toBe(LanguageKey.TypeScript);
		expect(languageForExtension("foo.tsx")).toBe(LanguageKey.TSX);
		expect(languageForExtension("foo.js")).toBe(LanguageKey.JavaScript);
		expect(languageForExtension("foo.json")).toBe(LanguageKey.JSON);
		expect(languageForExtension("foo.py")).toBe(LanguageKey.Python);
		expect(languageForExtension("foo.rs")).toBe(LanguageKey.Rust);
		expect(languageForExtension("foo.go")).toBe(LanguageKey.Go);
		expect(languageForExtension("foo.md")).toBe(LanguageKey.Markdown);
		expect(languageForExtension("foo.css")).toBe(LanguageKey.CSS);
		expect(languageForExtension("foo.yaml")).toBe(LanguageKey.YAML);
		expect(languageForExtension("foo.toml")).toBe(LanguageKey.TOML);
		expect(languageForExtension("foo.sql")).toBe(LanguageKey.SQL);
	});

	it("handles nested paths + windows separators", () => {
		expect(languageForExtension("/abs/path/to/file.ts")).toBe(LanguageKey.TypeScript);
		expect(languageForExtension("rel\\path\\file.tsx")).toBe(LanguageKey.TSX);
	});

	it("is case-insensitive on the extension", () => {
		expect(languageForExtension("FOO.TS")).toBe(LanguageKey.TypeScript);
		expect(languageForExtension("Image.JSON")).toBe(LanguageKey.JSON);
	});

	it("recognises mts / cts / mjs / cjs as TS / JS", () => {
		expect(languageForExtension("a.mts")).toBe(LanguageKey.TypeScript);
		expect(languageForExtension("a.cts")).toBe(LanguageKey.TypeScript);
		expect(languageForExtension("a.mjs")).toBe(LanguageKey.JavaScript);
		expect(languageForExtension("a.cjs")).toBe(LanguageKey.JavaScript);
	});

	it("recognises special filenames over extensions", () => {
		expect(languageForExtension("Dockerfile")).toBe(LanguageKey.Dockerfile);
		expect(languageForExtension("path/to/Dockerfile")).toBe(LanguageKey.Dockerfile);
		expect(languageForExtension("Makefile")).toBe(LanguageKey.Shell);
		expect(languageForExtension("tsconfig.json")).toBe(LanguageKey.JSONC);
	});

	it("returns Unknown for unmapped extensions / extensionless files", () => {
		expect(languageForExtension("foo.unknown-ext")).toBe(LanguageKey.Unknown);
		expect(languageForExtension("README")).toBe(LanguageKey.Unknown);
		expect(languageForExtension("")).toBe(LanguageKey.Unknown);
	});

	it("treats `.hidden` files as extensionless when there's no dot inside", () => {
		// `.gitignore` is in SPECIAL_FILENAMES so it should still resolve
		expect(languageForExtension(".gitignore")).toBe(LanguageKey.PlainText);
	});
});

describe("languageForMime", () => {
	it("recognises core MIME types", () => {
		expect(languageForMime("text/x-typescript")).toBe(LanguageKey.TypeScript);
		expect(languageForMime("text/javascript")).toBe(LanguageKey.JavaScript);
		expect(languageForMime("application/json")).toBe(LanguageKey.JSON);
		expect(languageForMime("text/html")).toBe(LanguageKey.HTML);
		expect(languageForMime("text/markdown")).toBe(LanguageKey.Markdown);
		expect(languageForMime("application/x-sh")).toBe(LanguageKey.Shell);
	});

	it("ignores MIME parameters", () => {
		expect(languageForMime("application/json; charset=utf-8")).toBe(LanguageKey.JSON);
	});

	it("is case-insensitive", () => {
		expect(languageForMime("APPLICATION/JSON")).toBe(LanguageKey.JSON);
	});

	it("returns Unknown for unmapped MIME types", () => {
		expect(languageForMime("application/octet-stream")).toBe(LanguageKey.Unknown);
		expect(languageForMime("")).toBe(LanguageKey.Unknown);
	});
});

describe("languageForShebang", () => {
	it("recognises python / node / bash / deno / bun", () => {
		expect(languageForShebang("#!/usr/bin/env python3")).toBe(LanguageKey.Python);
		expect(languageForShebang("#!/usr/bin/env node")).toBe(LanguageKey.JavaScript);
		expect(languageForShebang("#!/bin/bash")).toBe(LanguageKey.Shell);
		expect(languageForShebang("#!/usr/bin/env deno run")).toBe(LanguageKey.TypeScript);
		expect(languageForShebang("#!/usr/bin/env bun")).toBe(LanguageKey.TypeScript);
	});

	it("returns Unknown for non-shebang lines", () => {
		expect(languageForShebang("import { foo } from 'bar';")).toBe(LanguageKey.Unknown);
		expect(languageForShebang("")).toBe(LanguageKey.Unknown);
	});

	it("returns Unknown for unrecognised interpreters", () => {
		expect(languageForShebang("#!/usr/bin/env tcl")).toBe(LanguageKey.Unknown);
	});
});

describe("resolveLanguage", () => {
	it("prefers extension over MIME over shebang", () => {
		expect(
			resolveLanguage({
				path: "foo.py",
				mime: "text/html",
				firstLine: "#!/usr/bin/env node",
			}),
		).toBe(LanguageKey.Python);
	});

	it("falls back to MIME when path is unknown", () => {
		expect(
			resolveLanguage({
				path: "foo.unknown-ext",
				mime: "application/json",
			}),
		).toBe(LanguageKey.JSON);
	});

	it("falls back to shebang when neither path nor MIME hit", () => {
		expect(
			resolveLanguage({
				path: "foo",
				firstLine: "#!/usr/bin/env python3",
			}),
		).toBe(LanguageKey.Python);
	});

	it("returns Unknown when every signal is empty", () => {
		expect(resolveLanguage({})).toBe(LanguageKey.Unknown);
	});
});
