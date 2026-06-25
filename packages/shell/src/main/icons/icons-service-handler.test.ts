import { describe, expect, it, vi } from "vitest";
import type { Envelope } from "../../ipc/envelope";
import type { IconEntry, IconUploadResult } from "./icon-store";
import {
	type IconsServiceOptions,
	MAX_ICON_BASE64_LEN,
	makeIconsServiceHandler,
} from "./icons-service-handler";

function env(method: string, args: unknown[]): Envelope {
	return { v: 1, msg: "m1", app: "io.test.app", service: "icons", method, args, caps: [] };
}

const UPLOAD_RESULT: IconUploadResult = { url: "brainstorm://icon/a.png", thumbUrl: "t" };
const ENTRY: IconEntry = {
	url: "brainstorm://icon/a.png",
	thumbUrl: "t",
	hash: "a",
	uploadedAt: 1,
};

function stubOptions(over: Partial<IconsServiceOptions> = {}): IconsServiceOptions {
	return {
		uploadBytes: vi.fn(async () => UPLOAD_RESULT),
		list: vi.fn(async () => [ENTRY]),
		deleteIcon: vi.fn(async () => true),
		...over,
	};
}

describe("makeIconsServiceHandler", () => {
	it("uploadBytes delegates the name + base64 to the store op", async () => {
		const options = stubOptions();
		const handler = makeIconsServiceHandler(options);
		const result = await handler(env("uploadBytes", [{ name: "x.png", bytesBase64: "AAA" }]));
		expect(options.uploadBytes).toHaveBeenCalledWith("x.png", "AAA");
		expect(result).toEqual(UPLOAD_RESULT);
	});

	it("list returns the store's entries", async () => {
		const handler = makeIconsServiceHandler(stubOptions());
		expect(await handler(env("list", []))).toEqual([ENTRY]);
	});

	it("delete delegates the url", async () => {
		const options = stubOptions();
		const handler = makeIconsServiceHandler(options);
		expect(await handler(env("delete", [{ url: "brainstorm://icon/a.png" }]))).toBe(true);
		expect(options.deleteIcon).toHaveBeenCalledWith("brainstorm://icon/a.png");
	});

	it("rejects an unknown method as Invalid", async () => {
		const handler = makeIconsServiceHandler(stubOptions());
		await expect(handler(env("nope", []))).rejects.toMatchObject({ name: "Invalid" });
	});

	it("rejects uploadBytes with a non-object arg as Invalid", async () => {
		const handler = makeIconsServiceHandler(stubOptions());
		await expect(handler(env("uploadBytes", ["str"]))).rejects.toMatchObject({ name: "Invalid" });
	});

	it("rejects uploadBytes with a missing name/bytes as Invalid", async () => {
		const handler = makeIconsServiceHandler(stubOptions());
		await expect(handler(env("uploadBytes", [{ name: "x.png" }]))).rejects.toMatchObject({
			name: "Invalid",
		});
		await expect(handler(env("uploadBytes", [{ bytesBase64: "AAA" }]))).rejects.toMatchObject({
			name: "Invalid",
		});
	});

	it("rejects an over-size base64 payload (and never calls the store)", async () => {
		const options = stubOptions();
		const handler = makeIconsServiceHandler(options);
		const huge = "A".repeat(MAX_ICON_BASE64_LEN + 1);
		await expect(
			handler(env("uploadBytes", [{ name: "x.png", bytesBase64: huge }])),
		).rejects.toMatchObject({ name: "Invalid" });
		expect(options.uploadBytes).not.toHaveBeenCalled();
	});

	it("rejects delete with a non-string url as Invalid", async () => {
		const handler = makeIconsServiceHandler(stubOptions());
		await expect(handler(env("delete", [{ url: 5 }]))).rejects.toMatchObject({ name: "Invalid" });
	});
});
