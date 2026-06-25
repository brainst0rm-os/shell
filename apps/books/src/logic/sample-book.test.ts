import { describe, expect, it } from "vitest";
import { BookFormat, emptyReadingState } from "../types/book";
import { IconKind } from "../types/icon";
import { SAMPLE_BOOK_CONTENT, sampleBook } from "./sample-book";

describe("sample book content", () => {
	it("has multiple spine items each with at least one block", () => {
		expect(SAMPLE_BOOK_CONTENT.spine.length).toBeGreaterThan(1);
		for (const item of SAMPLE_BOOK_CONTENT.spine) {
			expect(item.blocks.length).toBeGreaterThan(0);
			expect(item.title).toBeTruthy();
		}
	});
});

describe("sampleBook catalog record", () => {
	it("is an EPUB with no backing file and an empty reading state", () => {
		const book = sampleBook(1000);
		expect(book.format).toBe(BookFormat.Epub);
		expect(book.fileId).toBeNull();
		expect(book.spineLength).toBe(SAMPLE_BOOK_CONTENT.spine.length);
		expect(book.reading).toEqual(emptyReadingState());
		expect(book.icon).toEqual({ kind: IconKind.Emoji, value: "📖" });
		expect(book.createdAt).toBe(1000);
	});
});
