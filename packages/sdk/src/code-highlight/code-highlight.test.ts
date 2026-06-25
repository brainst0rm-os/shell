/**
 * Shared Shiki tokenizer — lazy-load + singleton + concurrent-load + grammar
 * fallback paths exercised through a DI'd fake highlighter (the real Shiki
 * core is exercised at app integration / build time). String-keyed API:
 * `ensureShikiLanguage` / `tokenizeShiki` / `isHighlightableLanguage`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	HighlightTheme,
	ensureShikiLanguage,
	isHighlightableLanguage,
	resetHighlighter,
	setHighlighterFactory,
	tokenizeShiki,
} from "./index";

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

describe("isHighlightableLanguage", () => {
	it("is true for shipped grammars, false otherwise", () => {
		expect(isHighlightableLanguage("typescript")).toBe(true);
		expect(isHighlightableLanguage("docker")).toBe(true);
		expect(isHighlightableLanguage("brainfuck")).toBe(false);
		expect(isHighlightableLanguage("")).toBe(false);
	});
});

describe("ensureShikiLanguage + tokenizeShiki", () => {
	let highlighter: FakeHighlighter;
	let loadChunk: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		highlighter = fakeHighlighter();
		// Mirror the default loader: only shipped grammars resolve a chunk;
		// unknown ids yield null (the "we don't highlight this" signal).
		loadChunk = vi.fn(async (id: string) => (isHighlightableLanguage(id) ? ({} as never) : null));
		setHighlighterFactory(async () => highlighter as never, loadChunk as never);
	});

	afterEach(() => {
		resetHighlighter();
	});

	it("loads a grammar once and reports ready", async () => {
		expect(await ensureShikiLanguage("typescript")).toBe(true);
		expect(highlighter.loadLanguage).toHaveBeenCalledTimes(1);
	});

	it("reuses a loaded grammar (no second load)", async () => {
		await ensureShikiLanguage("typescript");
		await ensureShikiLanguage("typescript");
		expect(highlighter.loadLanguage).toHaveBeenCalledTimes(1);
	});

	it("shares one in-flight load across concurrent callers", async () => {
		const [a, b] = await Promise.all([
			ensureShikiLanguage("typescript"),
			ensureShikiLanguage("typescript"),
		]);
		expect(a).toBe(true);
		expect(b).toBe(true);
		expect(highlighter.loadLanguage).toHaveBeenCalledTimes(1);
	});

	it("returns false for an unknown / empty id", async () => {
		expect(await ensureShikiLanguage("brainfuck")).toBe(false);
		expect(await ensureShikiLanguage("")).toBe(false);
		expect(await ensureShikiLanguage(null)).toBe(false);
		expect(await ensureShikiLanguage(undefined)).toBe(false);
	});

	it("returns false when the chunk loader yields nothing", async () => {
		loadChunk.mockResolvedValueOnce(null);
		expect(await ensureShikiLanguage("typescript")).toBe(false);
	});

	it("returns false when loadLanguage throws", async () => {
		highlighter = fakeHighlighter({ loadFails: true });
		setHighlighterFactory(async () => highlighter as never, loadChunk as never);
		expect(await ensureShikiLanguage("typescript")).toBe(false);
	});

	it("tokenizes a ready language", async () => {
		const tokens = await tokenizeShiki("const x = 1", "typescript", HighlightTheme.Dark);
		expect(tokens).toEqual([[{ content: "const x = 1", color: "#000" }]]);
		expect(highlighter.codeToTokensBase).toHaveBeenCalledWith("const x = 1", {
			lang: "typescript",
			theme: HighlightTheme.Dark,
		});
	});

	it("returns null for an unhighlighted id without tokenizing", async () => {
		expect(await tokenizeShiki("hello", null)).toBeNull();
		expect(await tokenizeShiki("hello", "brainfuck")).toBeNull();
		expect(highlighter.codeToTokensBase).not.toHaveBeenCalled();
	});

	it("returns null when tokenization throws", async () => {
		highlighter = fakeHighlighter({ tokenizeThrows: true });
		setHighlighterFactory(async () => highlighter as never, loadChunk as never);
		expect(await tokenizeShiki("boom", "typescript")).toBeNull();
	});
});
