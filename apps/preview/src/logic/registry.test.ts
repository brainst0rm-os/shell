/**
 * Tests for the per-kind lazy-loader registry. 9.20.1.5 fills the
 * registry with Image / Markdown / Text via `registerBuiltInPreviewModules`;
 * those three loaders dynamic-import their module bundles so the cold-
 * start path stays light.
 */
import { afterEach, describe, expect, it } from "vitest";
import { PreviewKind } from "../types/preview-kind";
import type { PreviewModule } from "../types/preview-module";
import {
	_resetPreviewRegistryForTests,
	loaderFor,
	registerBuiltInPreviewModules,
	registerPreviewModule,
	registeredKindCount,
} from "./registry";

afterEach(() => {
	_resetPreviewRegistryForTests();
});

describe("preview module registry", () => {
	it("starts empty before any registration call", () => {
		expect(registeredKindCount()).toBe(0);
		for (const kind of Object.values(PreviewKind)) {
			expect(loaderFor(kind)).toBeNull();
		}
	});

	it("returns the registered loader for a kind", async () => {
		const fakeModule: PreviewModule = {
			kind: PreviewKind.Text,
			mount: () => ({ dispose: () => {} }),
		};
		const loader = async () => fakeModule;
		registerPreviewModule(PreviewKind.Text, loader);
		const found = loaderFor(PreviewKind.Text);
		expect(found).toBe(loader);
		const resolved = await found?.();
		expect(resolved?.kind).toBe(PreviewKind.Text);
	});

	it("registering the same loader twice for the same kind is a no-op (idempotent)", () => {
		const loader = async () => ({
			kind: PreviewKind.Image,
			mount: () => ({ dispose: () => {} }),
		});
		registerPreviewModule(PreviewKind.Image, loader);
		expect(() => registerPreviewModule(PreviewKind.Image, loader)).not.toThrow();
		expect(registeredKindCount()).toBe(1);
	});

	it("registering a DIFFERENT loader for an already-claimed kind throws — catches copy-paste rebinds", () => {
		const loaderA = async () => ({
			kind: PreviewKind.Image,
			mount: () => ({ dispose: () => {} }),
		});
		const loaderB = async () => ({
			kind: PreviewKind.Image,
			mount: () => ({ dispose: () => {} }),
		});
		registerPreviewModule(PreviewKind.Image, loaderA);
		expect(() => registerPreviewModule(PreviewKind.Image, loaderB)).toThrow(/already has/);
	});

	it("registerBuiltInPreviewModules wires Image / Markdown / Text / Video / Audio / Code / Pdf / Model", () => {
		registerBuiltInPreviewModules();
		expect(loaderFor(PreviewKind.Image)).not.toBeNull();
		expect(loaderFor(PreviewKind.Markdown)).not.toBeNull();
		expect(loaderFor(PreviewKind.Text)).not.toBeNull();
		expect(loaderFor(PreviewKind.Video)).not.toBeNull();
		expect(loaderFor(PreviewKind.Audio)).not.toBeNull();
		expect(loaderFor(PreviewKind.Code)).not.toBeNull();
		// Pdf landed in 9.20.5 (lazy pdf.js loader).
		expect(loaderFor(PreviewKind.Pdf)).not.toBeNull();
		// Model landed in 9.20.10 (lazy three.js loader).
		expect(loaderFor(PreviewKind.Model)).not.toBeNull();
		// Raw landed in 9.20.11 (embedded-JPEG extractor → image renderer).
		expect(loaderFor(PreviewKind.Raw)).not.toBeNull();
		// Office landed in 9.20.9 (mammoth / xlsx / fflate).
		expect(loaderFor(PreviewKind.Office)).not.toBeNull();
		// Heic landed in 9.20.8 (libheif decode → image renderer).
		expect(loaderFor(PreviewKind.Heic)).not.toBeNull();
	});

	it("registerBuiltInPreviewModules is idempotent across repeat calls", () => {
		registerBuiltInPreviewModules();
		expect(() => registerBuiltInPreviewModules()).not.toThrow();
		expect(registeredKindCount()).toBe(11);
	});
});
