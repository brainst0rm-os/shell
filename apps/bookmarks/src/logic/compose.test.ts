import { describe, expect, it } from "vitest";
import type { Bookmark } from "../types/bookmark";
import { ComposeError, applyTagEdit, composeBookmark } from "./compose";

const DEPS = { idFactory: () => "bm-fixed", now: () => 1_000 } as const;

function bookmark(over: Partial<Bookmark>): Bookmark {
	return {
		id: "b0",
		url: "https://example.com",
		title: "Example",
		icon: null,
		faviconUrl: null,
		coverImageUrl: null,
		tags: [],
		savedAt: 0,
		readAt: null,
		archivedAt: null,
		colorHint: null,
		createdAt: 0,
		updatedAt: 0,
		...over,
	};
}

describe("composeBookmark", () => {
	it("normalizes the URL and builds a full bookmark", () => {
		const r = composeBookmark({ url: "anthropic.com/research" }, [], DEPS);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.bookmark.url).toBe("https://anthropic.com/research");
		expect(r.bookmark.id).toBe("bm-fixed");
		expect(r.bookmark.savedAt).toBe(1_000);
		expect(r.bookmark.createdAt).toBe(1_000);
	});

	it("defaults the title to the domain when blank", () => {
		const r = composeBookmark({ url: "https://anthropic.com/x", title: "  " }, [], DEPS);
		expect(r.ok && r.bookmark.title).toBe("anthropic.com");
	});

	it("keeps a user-supplied title", () => {
		const r = composeBookmark({ url: "https://a.com", title: " Hi " }, [], DEPS);
		expect(r.ok && r.bookmark.title).toBe("Hi");
	});

	it("rejects a non-http(s) URL", () => {
		const r = composeBookmark({ url: "mailto:a@b.com" }, [], DEPS);
		expect(r.ok).toBe(false);
		expect(!r.ok && r.error).toBe(ComposeError.InvalidUrl);
	});

	it("rejects an empty URL", () => {
		const r = composeBookmark({ url: "   " }, [], DEPS);
		expect(!r.ok && r.error).toBe(ComposeError.InvalidUrl);
	});

	it("rejects a duplicate of an existing normalized URL", () => {
		const existing = [bookmark({ url: "https://anthropic.com" })];
		const r = composeBookmark({ url: "  ANTHROPIC.com/  " }, existing, DEPS);
		expect(!r.ok && r.error).toBe(ComposeError.Duplicate);
	});

	it("normalizes + dedupes tags from a comma string", () => {
		const r = composeBookmark({ url: "https://a.com", tags: "Work, work,  Read Later ," }, [], DEPS);
		expect(r.ok && [...r.bookmark.tags]).toEqual(["work", "read-later"]);
	});

	it("accepts a pre-split tag list", () => {
		const r = composeBookmark({ url: "https://a.com", tags: ["A", "b"] }, [], DEPS);
		expect(r.ok && [...r.bookmark.tags]).toEqual(["a", "b"]);
	});

	it("omits description when blank, keeps it when present", () => {
		const blank = composeBookmark({ url: "https://a.com", description: "  " }, [], DEPS);
		expect(blank.ok && blank.bookmark.description).toBeUndefined();
		const set = composeBookmark({ url: "https://a.com", description: " hi " }, [], DEPS);
		expect(set.ok && set.bookmark.description).toBe("hi");
	});
});

describe("applyTagEdit", () => {
	it("returns the same reference when nothing changed", () => {
		const b = bookmark({ tags: ["a", "b"] });
		expect(applyTagEdit(b, "a, b", () => 5)).toBe(b);
	});

	it("returns a patched bookmark with normalized tags + bumped updatedAt", () => {
		const b = bookmark({ tags: ["a"], updatedAt: 1 });
		const next = applyTagEdit(b, "A, New Tag", () => 99);
		expect(next).not.toBe(b);
		expect([...next.tags]).toEqual(["a", "new-tag"]);
		expect(next.updatedAt).toBe(99);
	});

	it("clears all tags", () => {
		const b = bookmark({ tags: ["a", "b"] });
		const next = applyTagEdit(b, "  ", () => 7);
		expect([...next.tags]).toEqual([]);
	});
});
