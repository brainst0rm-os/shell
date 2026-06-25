import { describe, expect, it } from "vitest";
import {
	CONTENT_KIND_LABEL_KEY,
	ContentKind,
	classifyMediaType,
	hasDistinctKind,
} from "./content-kind";

describe("classifyMediaType", () => {
	it("maps the bare canonical types", () => {
		expect(classifyMediaType("article")).toBe(ContentKind.Article);
		expect(classifyMediaType("website")).toBe(ContentKind.Website);
		expect(classifyMediaType("profile")).toBe(ContentKind.Profile);
		expect(classifyMediaType("product")).toBe(ContentKind.Product);
	});

	it("folds dotted Open Graph sub-types to their root kind", () => {
		expect(classifyMediaType("video.movie")).toBe(ContentKind.Video);
		expect(classifyMediaType("video.tv_show")).toBe(ContentKind.Video);
		expect(classifyMediaType("music.song")).toBe(ContentKind.Audio);
		expect(classifyMediaType("books.book")).toBe(ContentKind.Book);
	});

	it("aliases related roots onto one kind", () => {
		expect(classifyMediaType("blog")).toBe(ContentKind.Article);
		expect(classifyMediaType("audio")).toBe(ContentKind.Audio);
		expect(classifyMediaType("photo")).toBe(ContentKind.Image);
		expect(classifyMediaType("book")).toBe(ContentKind.Book);
	});

	it("tolerates casing + surrounding whitespace", () => {
		expect(classifyMediaType("  Article ")).toBe(ContentKind.Article);
		expect(classifyMediaType("VIDEO.MOVIE")).toBe(ContentKind.Video);
	});

	it("falls back to Page for empty / unknown / non-string input", () => {
		expect(classifyMediaType("")).toBe(ContentKind.Page);
		expect(classifyMediaType("   ")).toBe(ContentKind.Page);
		expect(classifyMediaType("something.weird")).toBe(ContentKind.Page);
		expect(classifyMediaType(undefined)).toBe(ContentKind.Page);
		expect(classifyMediaType(null)).toBe(ContentKind.Page);
	});
});

describe("CONTENT_KIND_LABEL_KEY", () => {
	it("has a label key for every kind", () => {
		for (const kind of Object.values(ContentKind)) {
			expect(typeof CONTENT_KIND_LABEL_KEY[kind]).toBe("string");
			expect(CONTENT_KIND_LABEL_KEY[kind].length).toBeGreaterThan(0);
		}
	});
});

describe("hasDistinctKind", () => {
	it("is false for the unmarked generic kinds", () => {
		expect(hasDistinctKind(ContentKind.Page)).toBe(false);
		expect(hasDistinctKind(ContentKind.Website)).toBe(false);
	});
	it("is true for distinctive kinds that warrant a badge", () => {
		expect(hasDistinctKind(ContentKind.Article)).toBe(true);
		expect(hasDistinctKind(ContentKind.Video)).toBe(true);
		expect(hasDistinctKind(ContentKind.Book)).toBe(true);
	});
});
