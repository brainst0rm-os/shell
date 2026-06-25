import { describe, expect, it } from "vitest";
import {
	IMAGE_EXTENSIONS,
	MAX_INLINE_IMAGE_BYTES,
	PickImageKind,
	type PickImageService,
	bytesToDataUrl,
	extensionOf,
	mimeForExtension,
	pickImage,
} from "./image-pick";

const handle = (displayName: string) => ({ handleId: "h1", displayName });

/** A fake Files service driven by the test. */
function fakeFiles(opts: {
	open: readonly { handleId: string; displayName: string }[];
	read?: Uint8Array | Error;
}): PickImageService {
	return {
		requestOpen: async () => opts.open,
		read: async () => {
			if (opts.read instanceof Error) throw opts.read;
			return opts.read ?? new Uint8Array();
		},
	};
}

describe("mimeForExtension", () => {
	it("maps the supported raster extensions", () => {
		expect(mimeForExtension("png")).toBe("image/png");
		expect(mimeForExtension("jpg")).toBe("image/jpeg");
		expect(mimeForExtension("jpeg")).toBe("image/jpeg");
		expect(mimeForExtension("webp")).toBe("image/webp");
	});
	it("returns null for unsupported extensions", () => {
		expect(mimeForExtension("svg")).toBeNull();
		expect(mimeForExtension("pdf")).toBeNull();
		expect(mimeForExtension("")).toBeNull();
	});
});

describe("extensionOf", () => {
	it("lowercases the tail after the last dot", () => {
		expect(extensionOf("photo.PNG")).toBe("png");
		expect(extensionOf("a.b.JPEG")).toBe("jpeg");
	});
	it("returns empty for no-extension + dotfiles", () => {
		expect(extensionOf("noext")).toBe("");
		expect(extensionOf(".hidden")).toBe("");
		expect(extensionOf("trailing.")).toBe("");
	});
});

describe("bytesToDataUrl", () => {
	it("base64-encodes bytes behind the mime prefix", () => {
		const bytes = new Uint8Array([104, 105]); // "hi"
		expect(bytesToDataUrl(bytes, "image/png")).toBe(`data:image/png;base64,${btoa("hi")}`);
	});
	it("handles a multi-chunk buffer without overflowing the call stack", () => {
		const bytes = new Uint8Array(0x8000 + 16).fill(65); // > one 0x8000 chunk
		const url = bytesToDataUrl(bytes, "image/jpeg");
		expect(url.startsWith("data:image/jpeg;base64,")).toBe(true);
		// Round-trips back to the same byte length.
		const b64 = url.slice("data:image/jpeg;base64,".length);
		expect(atob(b64).length).toBe(bytes.length);
	});
});

describe("pickImage", () => {
	it("returns Cancelled when the picker yields nothing", async () => {
		const out = await pickImage(fakeFiles({ open: [] }));
		expect(out.kind).toBe(PickImageKind.Cancelled);
	});

	it("returns Unsupported for a non-image extension", async () => {
		const out = await pickImage(fakeFiles({ open: [handle("notes.txt")] }));
		expect(out.kind).toBe(PickImageKind.Unsupported);
		if (out.kind === PickImageKind.Unsupported) expect(out.extension).toBe("txt");
	});

	it("returns Picked with a data URL on success", async () => {
		const out = await pickImage(
			fakeFiles({ open: [handle("pic.png")], read: new Uint8Array([1, 2, 3]) }),
		);
		expect(out.kind).toBe(PickImageKind.Picked);
		if (out.kind === PickImageKind.Picked) {
			expect(out.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
			expect(out.filename).toBe("pic.png");
		}
	});

	it("collapses a read rejection to Failed (never throws)", async () => {
		const out = await pickImage(fakeFiles({ open: [handle("pic.webp")], read: new Error("EPERM") }));
		expect(out.kind).toBe(PickImageKind.Failed);
	});

	it("rejects an image over the inline ceiling as TooLarge (no data URL built)", async () => {
		const huge = new Uint8Array(MAX_INLINE_IMAGE_BYTES + 1);
		const out = await pickImage(fakeFiles({ open: [handle("huge.png")], read: huge }));
		expect(out.kind).toBe(PickImageKind.TooLarge);
		if (out.kind === PickImageKind.TooLarge) {
			expect(out.bytes).toBe(MAX_INLINE_IMAGE_BYTES + 1);
			expect(out.limit).toBe(MAX_INLINE_IMAGE_BYTES);
		}
	});

	it("accepts an image exactly at the ceiling", async () => {
		const atLimit = new Uint8Array(MAX_INLINE_IMAGE_BYTES);
		const out = await pickImage(fakeFiles({ open: [handle("ok.png")], read: atLimit }));
		expect(out.kind).toBe(PickImageKind.Picked);
	});

	it("passes every supported extension to the picker filter", () => {
		// Sanity: the exported list is the wallpaper-parity raster set.
		expect([...IMAGE_EXTENSIONS]).toEqual(["png", "jpg", "jpeg", "gif", "webp", "avif"]);
	});
});
