/**
 * Highlight integration — pure logic + DI'd highlighter factory.
 *
 * We exercise the lazy-load + singleton + concurrent-load + grammar
 * fallback paths via fake factories. The real Shiki highlighter is
 * exercised at integration time via the app build; the unit-test
 * factory swap keeps this suite fast and deterministic.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageKey } from "../types/code-file";
import {
	HighlightTheme,
	ensureLanguageLoaded,
	resetHighlighter,
	setHighlighterFactory,
	shikiLanguageId,
	tokenizeCode,
} from "./highlight";

interface FakeHighlighter {
	loadLanguage: ReturnType<typeof vi.fn>;
	codeToTokensBase: ReturnType<typeof vi.fn>;
}

function fakeHighlighter(opts?: {
	loadFails?: boolean;
	tokenizeThrows?: boolean;
}): FakeHighlighter {
	return {
		loadLanguage: vi.fn(async () => {
			if (opts?.loadFails) throw new Error("nope");
		}),
		codeToTokensBase: vi.fn((code: string) => {
			if (opts?.tokenizeThrows) throw new Error("tok-nope");
			return [[{ content: code, color: "#000" }]];
		}),
	};
}

describe("shikiLanguageId", () => {
	it("maps each known LanguageKey", () => {
		expect(shikiLanguageId(LanguageKey.TypeScript)).toBe("typescript");
		expect(shikiLanguageId(LanguageKey.Shell)).toBe("shellscript");
		expect(shikiLanguageId(LanguageKey.Dockerfile)).toBe("docker");
	});

	it("returns null for PlainText / Unknown", () => {
		expect(shikiLanguageId(LanguageKey.PlainText)).toBeNull();
		expect(shikiLanguageId(LanguageKey.Unknown)).toBeNull();
	});
});

describe("ensureLanguageLoaded + tokenizeCode", () => {
	let highlighter: FakeHighlighter;
	let loadChunk: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		highlighter = fakeHighlighter();
		loadChunk = vi.fn(async (_id: string) => ({}) as never);
		setHighlighterFactory(async () => highlighter as never, loadChunk as never);
	});
	afterEach(() => {
		resetHighlighter();
	});

	it("loads the grammar lazily on first request", async () => {
		expect(highlighter.loadLanguage).not.toHaveBeenCalled();
		expect(await ensureLanguageLoaded(LanguageKey.TypeScript)).toBe(true);
		expect(loadChunk).toHaveBeenCalledTimes(1);
		expect(loadChunk).toHaveBeenCalledWith("typescript");
		expect(highlighter.loadLanguage).toHaveBeenCalledTimes(1);
	});

	it("caches the loaded grammar across subsequent calls", async () => {
		await ensureLanguageLoaded(LanguageKey.TypeScript);
		await ensureLanguageLoaded(LanguageKey.TypeScript);
		expect(loadChunk).toHaveBeenCalledTimes(1);
		expect(highlighter.loadLanguage).toHaveBeenCalledTimes(1);
	});

	it("dedupes concurrent loads of the same language", async () => {
		const a = ensureLanguageLoaded(LanguageKey.TypeScript);
		const b = ensureLanguageLoaded(LanguageKey.TypeScript);
		const [ra, rb] = await Promise.all([a, b]);
		expect(ra).toBe(true);
		expect(rb).toBe(true);
		expect(loadChunk).toHaveBeenCalledTimes(1);
	});

	it("returns false for PlainText / Unknown without touching the highlighter", async () => {
		expect(await ensureLanguageLoaded(LanguageKey.PlainText)).toBe(false);
		expect(await ensureLanguageLoaded(LanguageKey.Unknown)).toBe(false);
		expect(loadChunk).not.toHaveBeenCalled();
	});

	it("returns false when the chunk loader resolves to null", async () => {
		setHighlighterFactory(
			async () => highlighter as never,
			async () => null,
		);
		expect(await ensureLanguageLoaded(LanguageKey.TypeScript)).toBe(false);
	});

	it("returns false when loadLanguage throws (caught)", async () => {
		const failing = fakeHighlighter({ loadFails: true });
		setHighlighterFactory(
			async () => failing as never,
			async () => ({}) as never,
		);
		expect(await ensureLanguageLoaded(LanguageKey.TypeScript)).toBe(false);
	});

	it("tokenizeCode returns null for unhighlighted languages", async () => {
		expect(await tokenizeCode("hello", LanguageKey.PlainText)).toBeNull();
	});

	it("tokenizeCode loads + tokenizes for a highlighted language", async () => {
		const result = await tokenizeCode("const x = 1;", LanguageKey.TypeScript, HighlightTheme.Light);
		expect(result).not.toBeNull();
		expect(highlighter.codeToTokensBase).toHaveBeenCalledWith("const x = 1;", {
			lang: "typescript",
			theme: HighlightTheme.Light,
		});
	});

	it("tokenizeCode returns null when the highlighter throws", async () => {
		const throwing = fakeHighlighter({ tokenizeThrows: true });
		setHighlighterFactory(
			async () => throwing as never,
			async () => ({}) as never,
		);
		expect(await tokenizeCode("x", LanguageKey.TypeScript)).toBeNull();
	});
});
