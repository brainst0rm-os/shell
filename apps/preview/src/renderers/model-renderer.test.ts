// @vitest-environment jsdom
/**
 * Model renderer contract tests. The WebGL render path can't run under
 * jsdom (no GL context) — that's exercised in the real shell, like the
 * PDF canvas/worker. Here we cover the parse-free metadata, the kind
 * binding, and that a missing GL context fails cleanly rather than
 * wedging the host.
 */
import { describe, expect, it } from "vitest";
import { PreviewKind } from "../types/preview-kind";
import type { PreviewSource } from "../types/preview-module";
import { modelRenderer } from "./model-renderer";

describe("modelRenderer", () => {
	it("binds the Model kind", () => {
		expect(modelRenderer.kind).toBe(PreviewKind.Model);
	});

	it("reports a parse-free Format for known model MIMEs", () => {
		const meta = (src: PreviewSource) => modelRenderer.extractMetadata?.(src);
		expect(meta({ kind: "url", url: "x", mime: "model/gltf-binary", sizeBytes: 1 })).toEqual({
			Format: "glTF (binary)",
		});
		expect(meta({ kind: "url", url: "x", mime: "model/obj", sizeBytes: 1 })).toEqual({
			Format: "Wavefront OBJ",
		});
	});

	it("returns no metadata for a MIME it can't place", () => {
		expect(
			modelRenderer.extractMetadata?.({
				kind: "url",
				url: "x",
				mime: "application/octet-stream",
				sizeBytes: 1,
			}),
		).toEqual({});
	});

	it("fails cleanly (no throw past the host) when WebGL is unavailable", async () => {
		const host = document.createElement("div");
		const source: PreviewSource = {
			kind: "bytes",
			bytes: new Uint8Array([0]),
			mime: "model/gltf-binary",
		};
		await expect(
			modelRenderer.mount({
				host,
				source,
				file: { name: "m.glb", mime: source.mime, sizeBytes: 1, modifiedAt: null },
			}),
		).rejects.toThrow();
	});
});
