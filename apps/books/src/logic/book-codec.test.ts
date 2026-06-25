import { describe, expect, it } from "vitest";
import { type Book, BookFormat, emptyReadingState } from "../types/book";
import { IconKind } from "../types/icon";
import { makeLocator, serializeLocator } from "../types/locator";
import { type BookRecord, parseBook, serializeBook, withReadingPosition } from "./book-codec";

function aBook(overrides: Partial<Book> = {}): Book {
	return {
		id: "book-1",
		name: "On the Shape of Vaults",
		icon: { kind: IconKind.Emoji, value: "📖" },
		format: BookFormat.Epub,
		author: "A. Reader",
		fileId: "file-9",
		spineLength: 2,
		reading: emptyReadingState(),
		createdAt: 1000,
		updatedAt: 1000,
		...overrides,
	};
}

describe("book-codec", () => {
	it("round-trips a book through serialize → parse", () => {
		const book = aBook({
			reading: { position: makeLocator(1, 140), progress: 0.42, lastReadAt: 5000 },
		});
		const parsed = parseBook(serializeBook(book));
		expect(parsed).toEqual(book);
	});

	it("stores the reading position as the CFI wire form, not a blob", () => {
		const book = aBook({
			reading: { position: makeLocator(2, 17), progress: 0.5, lastReadAt: 1 },
		});
		const record = serializeBook(book);
		expect(record.reading.position).toBe(serializeLocator(makeLocator(2, 17)));
		expect(typeof record.reading.position).toBe("string");
	});

	it("serializes a never-opened book with a null position", () => {
		const record = serializeBook(aBook());
		expect(record.reading).toEqual({ position: null, progress: 0, lastReadAt: null });
	});

	it("parses a never-opened record back to the empty reading state", () => {
		const record = serializeBook(aBook());
		expect(parseBook(record)?.reading).toEqual(emptyReadingState());
	});

	it("returns null for a record with no id", () => {
		expect(parseBook({ name: "Headless" } as Partial<BookRecord>)).toBeNull();
		expect(parseBook({ id: "" })).toBeNull();
	});

	it("falls back defensively on a partial / legacy record", () => {
		const parsed = parseBook({ id: "book-x", createdAt: 7 });
		expect(parsed).not.toBeNull();
		expect(parsed?.name).toBe("");
		expect(parsed?.format).toBe(BookFormat.Epub);
		expect(parsed?.author).toBe("");
		expect(parsed?.fileId).toBeNull();
		expect(parsed?.spineLength).toBe(0);
		expect(parsed?.reading).toEqual(emptyReadingState());
		expect(parsed?.updatedAt).toBe(7);
	});

	it("parses the pdf format and rejects an unknown format to epub", () => {
		expect(parseBook(serializeBook(aBook({ format: BookFormat.Pdf })))?.format).toBe(BookFormat.Pdf);
		expect(parseBook({ id: "b", format: "audiobook" })?.format).toBe(BookFormat.Epub);
	});

	it("drops a malformed reading.position string to null", () => {
		expect(
			parseBook({ id: "b", reading: { position: "not-a-cfi" } as never })?.reading.position,
		).toBeNull();
	});

	it("clamps an out-of-range progress on both serialize and parse", () => {
		expect(
			serializeBook(aBook({ reading: { position: null, progress: 2, lastReadAt: null } })).reading
				.progress,
		).toBe(1);
		expect(
			parseBook({ id: "b", reading: { position: null, progress: -1, lastReadAt: null } })?.reading
				.progress,
		).toBe(0);
	});

	it("preserves each icon kind through the codec", () => {
		expect(
			parseBook(serializeBook(aBook({ icon: { kind: IconKind.Pack, value: "book", color: "#abc" } })))
				?.icon,
		).toEqual({
			kind: IconKind.Pack,
			value: "book",
			color: "#abc",
		});
		expect(parseBook(serializeBook(aBook({ icon: null })))?.icon).toBeNull();
		expect(parseBook({ id: "b", icon: { kind: "weird", value: "x" } as never })?.icon).toBeNull();
	});

	describe("withReadingPosition", () => {
		it("parks the position, stamps progress + timestamps", () => {
			const next = withReadingPosition(aBook(), makeLocator(1, 50), 0.6, 9000);
			expect(next.reading).toEqual({ position: makeLocator(1, 50), progress: 0.6, lastReadAt: 9000 });
			expect(next.updatedAt).toBe(9000);
		});

		it("clamps the progress fraction", () => {
			expect(withReadingPosition(aBook(), makeLocator(0, 0), 5, 1).reading.progress).toBe(1);
		});

		it("does not mutate the input book", () => {
			const book = aBook();
			withReadingPosition(book, makeLocator(1, 1), 0.5, 1);
			expect(book.reading).toEqual(emptyReadingState());
		});
	});
});
