/**
 * Open-a-book resolution (9.21.5) — the pure half of the launch path. The
 * shell's only guaranteed delivery on a fresh launch is the handshake
 * `{ reason: "open-entity", entityId }` (the same contract Preview resolves
 * against), so Books turns a bare id into a `Book` via the capability-gated
 * `entities.get`, then — for a PDF — resolves the backing `File/v1` row to
 * the `brainstorm:` URL whose bytes the engine decodes. Bytes never cross
 * the preload bridge; the URL is the only transportable form.
 *
 * DOM-free + bridge-free so every branch is unit-tested.
 */

import { type Book, BookFormat } from "../types/book";
import type { Locator } from "../types/locator";
import { type BookRecord, parseBook, serializeBook, withReadingPosition } from "./book-codec";
import { bookRecordFromImport, formatFromName, titleFromName } from "./book-import";

/** The slice of an `entities.get` row this resolver reads — structurally
 *  typed so Books takes no cross-package type dependency. */
export type OpenableEntity = {
	id?: unknown;
	properties?: Record<string, unknown> | null;
};

function readString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

/** Pull the target entity id off a launch handshake / intent payload. */
export function entityIdFromPayload(payload: unknown): string | null {
	if (!payload || typeof payload !== "object") return null;
	return readString((payload as { entityId?: unknown }).entityId);
}

/** Decode a `Book/v1` row. The entity's own id wins over any `id` mirrored
 *  into properties (the row id is the authoritative one). */
export function bookFromEntity(entity: OpenableEntity | null | undefined): Book | null {
	if (!entity) return null;
	const id = readString(entity.id);
	const props = entity.properties;
	if (!id || !props || typeof props !== "object") return null;
	return parseBook({ ...props, id } as Parameters<typeof parseBook>[0]);
}

/** True when the book opens in PDF reading mode AND has a backing file to
 *  read from. An EPUB (or a file-less preview record) falls back to the
 *  reflow reader. */
export function isOpenablePdfBook(book: Book | null): book is Book & { fileId: string } {
	return book !== null && book.format === BookFormat.Pdf && book.fileId !== null;
}

/** Book format implied by a `File/v1`'s `mime` / `name` — the bridge that
 *  lets a raw PDF/EPUB file invoked from the Files app open in Books. MIME
 *  wins (it's the shell's sniffed truth); the filename extension is the
 *  fallback for files the mime map doesn't cover (EPUB seals as
 *  `application/octet-stream` today, so `.epub` only resolves by name). */
export function bookFormatFromFile(
	props: Record<string, unknown> | null | undefined,
): BookFormat | null {
	const mime = readString(props?.mime);
	if (mime === "application/pdf") return BookFormat.Pdf;
	if (mime === "application/epub+zip") return BookFormat.Epub;
	const name = readString(props?.name);
	return name ? formatFromName(name) : null;
}

/** Resolve an open invoked on a `brainstorm/File/v1` (a PDF/EPUB the user
 *  opened from Files) to the `Book/v1` that should mount. Reuses the catalog
 *  record that already wraps the file; otherwise mints one pointing at the
 *  file in place (no byte re-import — the `File/v1` is the source of truth).
 *  `record: null` means "open the existing book"; a record means "create it
 *  first, then open `bookId`". Returns `null` when the file isn't a book. */
export function resolveFileOpen(args: {
	fileId: string;
	fileProps: Record<string, unknown> | null | undefined;
	books: readonly Book[];
	newBookId: string;
	now: number;
}): { bookId: string; record: BookRecord | null } | null {
	const existing = args.books.find((b) => b.fileId === args.fileId);
	if (existing) return { bookId: existing.id, record: null };
	const format = bookFormatFromFile(args.fileProps);
	if (!format) return null;
	const name = readString(args.fileProps?.name) ?? "";
	const record = bookRecordFromImport({
		id: args.newBookId,
		fileId: args.fileId,
		title: titleFromName(name) || name,
		format,
		now: args.now,
	});
	return { bookId: args.newBookId, record };
}

export type BookFileSource = {
	url: string;
	mime: string | null;
};

/** Resolve a `brainstorm/File/v1` row to its fetchable URL. A row without
 *  a usable `attachment` URL resolves to `null` — the reader shows its
 *  honest "couldn't open" state rather than a broken surface. */
export function fileSourceFromEntity(
	entity: OpenableEntity | null | undefined,
): BookFileSource | null {
	const props = entity?.properties;
	if (!props || typeof props !== "object") return null;
	const url = readString(props.attachment);
	if (!url) return null;
	return { url, mime: readString(props.mime) };
}

/** Advance a book's reading state and produce the `entities.update` patch
 *  that persists it (the wire `reading` blob + denormalized `spineLength`
 *  so the library can render progress without re-opening the document).
 *  Returns the advanced `Book` so the host chains subsequent turns off it. */
export function readingPositionPatch(
	book: Book,
	locator: Locator,
	progress: number,
	spineLength: number,
	now: number,
): { book: Book; patch: Record<string, unknown> } {
	const advanced = { ...withReadingPosition(book, locator, progress, now), spineLength };
	const record = serializeBook(advanced);
	return {
		book: advanced,
		patch: {
			reading: record.reading,
			spineLength: record.spineLength,
			updatedAt: record.updatedAt,
		},
	};
}
