/**
 * Tests for `previewKindFor` — the keystone resolver that every
 * downstream iteration depends on. Covers: exact-MIME wins over
 * prefix, prefix-fallback, charset-suffix tolerance, empty/garbage
 * input, and every MIME the manifest enumerates.
 */
import { describe, expect, it } from "vitest";
import { PreviewKind } from "../types/preview-kind";
import { REGISTERED_MIMES, previewKindFor } from "./preview-kind-for";

describe("previewKindFor", () => {
	it("maps application/pdf → Pdf (exact)", () => {
		expect(previewKindFor("application/pdf")).toBe(PreviewKind.Pdf);
	});

	it("maps text/markdown → Markdown — wins over the text/* prefix fallback", () => {
		expect(previewKindFor("text/markdown")).toBe(PreviewKind.Markdown);
	});

	it("maps text/x-markdown → Markdown (legacy alias)", () => {
		expect(previewKindFor("text/x-markdown")).toBe(PreviewKind.Markdown);
	});

	it("maps text/plain → Text via the text/* prefix", () => {
		expect(previewKindFor("text/plain")).toBe(PreviewKind.Text);
	});

	it("maps application/javascript → Code so the Shiki renderer wins over fallbacks", () => {
		expect(previewKindFor("application/javascript")).toBe(PreviewKind.Code);
	});

	it("maps image/* / video/* / audio/* via prefix", () => {
		expect(previewKindFor("image/png")).toBe(PreviewKind.Image);
		expect(previewKindFor("video/mp4")).toBe(PreviewKind.Video);
		expect(previewKindFor("audio/mpeg")).toBe(PreviewKind.Audio);
	});

	it("maps HEIC/HEIF → Heic (exact, beating the image/* prefix) (9.20.8)", () => {
		expect(previewKindFor("image/heic")).toBe(PreviewKind.Heic);
		expect(previewKindFor("image/heif")).toBe(PreviewKind.Heic);
		expect(previewKindFor("image/heic-sequence")).toBe(PreviewKind.Heic);
	});

	it("strips a charset/encoding suffix before resolving", () => {
		expect(previewKindFor("text/plain; charset=utf-8")).toBe(PreviewKind.Text);
		expect(previewKindFor("application/pdf;version=1.7")).toBe(PreviewKind.Pdf);
	});

	it("is case-insensitive", () => {
		expect(previewKindFor("IMAGE/PNG")).toBe(PreviewKind.Image);
		expect(previewKindFor("Application/Pdf")).toBe(PreviewKind.Pdf);
	});

	it("returns null for empty / garbage / unknown MIMEs", () => {
		expect(previewKindFor("")).toBeNull();
		expect(previewKindFor("garbage")).toBeNull();
		expect(previewKindFor("application/octet-stream")).toBeNull();
	});

	it("maps 3D model MIMEs → Model (9.20.10)", () => {
		expect(previewKindFor("model/gltf-binary")).toBe(PreviewKind.Model);
		expect(previewKindFor("model/gltf+json")).toBe(PreviewKind.Model);
		expect(previewKindFor("model/obj")).toBe(PreviewKind.Model);
		expect(previewKindFor("text/prs.wavefront-obj")).toBe(PreviewKind.Model); // exact wins over text/*
		expect(previewKindFor("model/stl")).toBe(PreviewKind.Model); // model/* prefix future-proofing
	});

	it("every MIME the manifest enumerates resolves to a non-null kind", () => {
		for (const mime of REGISTERED_MIMES) {
			expect(previewKindFor(mime), mime).not.toBeNull();
		}
	});
});
