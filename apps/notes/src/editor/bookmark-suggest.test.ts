import { describe, expect, it } from "vitest";
import {
	BOOKMARK_ENTITY_TYPE,
	bookmarkEntityProperties,
	detectBareUrl,
	hostLabel,
} from "./bookmark-suggest";

describe("detectBareUrl", () => {
	it("accepts a single bare http(s) URL", () => {
		expect(detectBareUrl("https://example.com/article")).toBe("https://example.com/article");
		expect(detectBareUrl("http://example.com")).toBe("http://example.com");
	});

	it("trims surrounding whitespace", () => {
		expect(detectBareUrl("  https://example.com/x  ")).toBe("https://example.com/x");
	});

	it("strips a trailing slash on the bare root only", () => {
		expect(detectBareUrl("https://example.com/")).toBe("https://example.com");
		expect(detectBareUrl("https://example.com/path/")).toBe("https://example.com/path/");
	});

	it("rejects prose, even prose containing a URL", () => {
		expect(detectBareUrl("see https://example.com for details")).toBeNull();
		expect(detectBareUrl("hello world")).toBeNull();
	});

	it("rejects multi-line payloads", () => {
		expect(detectBareUrl("https://a.com\nhttps://b.com")).toBeNull();
	});

	it("rejects non-http(s) schemes", () => {
		expect(detectBareUrl("mailto:hi@example.com")).toBeNull();
		expect(detectBareUrl("ftp://example.com/file")).toBeNull();
		expect(detectBareUrl("javascript:alert(1)")).toBeNull();
		expect(detectBareUrl("file:///etc/passwd")).toBeNull();
	});

	it("rejects a schemeless host (too prose-like to auto-suggest)", () => {
		expect(detectBareUrl("example.com")).toBeNull();
	});

	it("rejects a dotless host", () => {
		expect(detectBareUrl("http://localhost:3000")).toBeNull();
	});

	it("rejects the empty string", () => {
		expect(detectBareUrl("")).toBeNull();
		expect(detectBareUrl("   ")).toBeNull();
	});
});

describe("hostLabel", () => {
	it("returns the host without a www. prefix", () => {
		expect(hostLabel("https://www.example.com/x")).toBe("example.com");
		expect(hostLabel("https://news.example.com/x")).toBe("news.example.com");
	});

	it("falls back to the raw input on a malformed URL", () => {
		expect(hostLabel("not a url")).toBe("not a url");
	});
});

describe("bookmarkEntityProperties", () => {
	it("builds a Bookmark/v1 property bag with host-fallback title + stamped timestamps", () => {
		const props = bookmarkEntityProperties("https://www.example.com/post", 1000);
		expect(props.url).toBe("https://www.example.com/post");
		expect(props.title).toBe("example.com");
		expect(props.tags).toEqual([]);
		expect(props.savedAt).toBe(1000);
		expect(props.createdAt).toBe(1000);
		expect(props.updatedAt).toBe(1000);
		expect(props.readAt).toBeNull();
		expect(props.archivedAt).toBeNull();
		expect(props.faviconUrl).toBeNull();
		expect(props.coverImageUrl).toBeNull();
		// The entities service owns the id — never carried in the bag.
		expect(props).not.toHaveProperty("id");
	});

	it("targets the Bookmarks-app-owned type", () => {
		expect(BOOKMARK_ENTITY_TYPE).toBe("brainstorm/Bookmark/v1");
	});
});
