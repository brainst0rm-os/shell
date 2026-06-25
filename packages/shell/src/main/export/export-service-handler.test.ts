import { describe, expect, it, vi } from "vitest";
import type { Envelope } from "../../ipc/envelope";
import {
	MAX_EXPORT_HTML_BYTES,
	type RenderHtmlToPdf,
	makeExportServiceHandler,
} from "./export-service-handler";

function env(method: string, args: unknown[]): Envelope {
	return { v: 1, msg: "m1", app: "io.test.app", service: "export", method, args, caps: [] };
}

const okRender: RenderHtmlToPdf = async () => new Uint8Array([1, 2, 3]);

describe("makeExportServiceHandler", () => {
	it("renders printToPdf via the injected renderer and returns its bytes", async () => {
		const render = vi.fn(okRender);
		const handler = makeExportServiceHandler({ renderHtmlToPdf: render });
		const result = await handler(env("printToPdf", [{ html: "<p>hi</p>" }]));
		expect(render).toHaveBeenCalledWith("<p>hi</p>");
		expect(result).toEqual(new Uint8Array([1, 2, 3]));
	});

	it("rejects an unknown method as Invalid", async () => {
		const handler = makeExportServiceHandler({ renderHtmlToPdf: okRender });
		await expect(handler(env("nope", [{ html: "x" }]))).rejects.toMatchObject({ name: "Invalid" });
	});

	it("rejects a non-object argument as Invalid", async () => {
		const handler = makeExportServiceHandler({ renderHtmlToPdf: okRender });
		await expect(handler(env("printToPdf", ["not-an-object"]))).rejects.toMatchObject({
			name: "Invalid",
		});
	});

	it("rejects a non-string html as Invalid", async () => {
		const handler = makeExportServiceHandler({ renderHtmlToPdf: okRender });
		await expect(handler(env("printToPdf", [{ html: 42 }]))).rejects.toMatchObject({
			name: "Invalid",
		});
	});

	it("rejects html over the size cap as Invalid (and never calls the renderer)", async () => {
		const render = vi.fn(okRender);
		const handler = makeExportServiceHandler({ renderHtmlToPdf: render });
		const huge = "a".repeat(MAX_EXPORT_HTML_BYTES + 1);
		await expect(handler(env("printToPdf", [{ html: huge }]))).rejects.toMatchObject({
			name: "Invalid",
		});
		expect(render).not.toHaveBeenCalled();
	});

	it("maps a renderer failure to Unavailable (not a hung request)", async () => {
		const handler = makeExportServiceHandler({
			renderHtmlToPdf: async () => {
				throw new Error("boom");
			},
		});
		await expect(handler(env("printToPdf", [{ html: "<p>x</p>" }]))).rejects.toMatchObject({
			name: "Unavailable",
		});
	});
});
