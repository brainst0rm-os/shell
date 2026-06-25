/**
 * Per-`PreviewKind` lazy-loader registry. Each entry is a dynamic
 * `import()` that returns the renderer module — the bundle for that
 * kind only loads when the host actually mounts it.
 *
 * 9.20.1 shipped an *empty* registry. 9.20.1.5 fills in Image /
 * Markdown / Text via `registerBuiltInPreviewModules`; later iterations
 * add Video / Audio / Code / PDF. The shape — `Map<PreviewKind,
 * PreviewModuleLoader>` — is the keystone that survives every swap.
 */

import { PreviewKind } from "../types/preview-kind";
import type { PreviewModuleLoader } from "../types/preview-module";

/** Internal mutable map — exposed only via the `register` /
 *  `loaderFor` API so callers can't accidentally overwrite an entry. */
const LOADERS = new Map<PreviewKind, PreviewModuleLoader>();

/** Register a per-kind loader. Idempotent — registering the same
 *  loader twice for the same kind is a no-op. Throws if a *different*
 *  loader is registered for an already-claimed kind (catches the
 *  copy-paste-rebound-module bug at boot time, not at first mount). */
export function registerPreviewModule(kind: PreviewKind, loader: PreviewModuleLoader): void {
	const existing = LOADERS.get(kind);
	if (existing && existing !== loader) {
		throw new Error(
			`preview/registry: kind ${kind} already has a different loader — refusing to overwrite`,
		);
	}
	LOADERS.set(kind, loader);
}

/** Look up the loader for `kind`. Returns `null` when no module is
 *  registered — the host renders the "no preview available" pane. */
export function loaderFor(kind: PreviewKind): PreviewModuleLoader | null {
	return LOADERS.get(kind) ?? null;
}

/** Number of registered loaders. Used by the readiness/diagnostics
 *  test that asserts Stage 9.20.1 ships an *empty* registry. */
export function registeredKindCount(): number {
	return LOADERS.size;
}

/** Reset the registry — test-only. Production has no need to
 *  un-register a renderer; the entry survives the app's lifetime. */
export function _resetPreviewRegistryForTests(): void {
	LOADERS.clear();
}

/** Register the renderers that ship in the 9.20.1.5 preview drop. Each
 *  loader is a dynamic `import()` so the renderer bundles stay off the
 *  cold-start path until the host actually mounts them. Idempotent —
 *  safe to call from `app.ts` at module-evaluation time AND from tests
 *  after `_resetPreviewRegistryForTests`. */
export function registerBuiltInPreviewModules(): void {
	registerPreviewModule(PreviewKind.Image, BUILT_IN_LOADERS.image);
	registerPreviewModule(PreviewKind.Markdown, BUILT_IN_LOADERS.markdown);
	registerPreviewModule(PreviewKind.Text, BUILT_IN_LOADERS.text);
	registerPreviewModule(PreviewKind.Video, BUILT_IN_LOADERS.video);
	registerPreviewModule(PreviewKind.Audio, BUILT_IN_LOADERS.audio);
	registerPreviewModule(PreviewKind.Code, BUILT_IN_LOADERS.code);
	registerPreviewModule(PreviewKind.Pdf, BUILT_IN_LOADERS.pdf);
	registerPreviewModule(PreviewKind.Model, BUILT_IN_LOADERS.model);
	registerPreviewModule(PreviewKind.Raw, BUILT_IN_LOADERS.raw);
	registerPreviewModule(PreviewKind.Office, BUILT_IN_LOADERS.office);
	registerPreviewModule(PreviewKind.Heic, BUILT_IN_LOADERS.heic);
}

const BUILT_IN_LOADERS = {
	image: async () => (await import("../renderers/image-renderer")).imageRenderer,
	markdown: async () => (await import("../renderers/markdown-renderer")).markdownRenderer,
	text: async () => (await import("../renderers/text-renderer")).textRenderer,
	video: async () => (await import("../renderers/video-renderer")).videoRenderer,
	audio: async () => (await import("../renderers/audio-renderer")).audioRenderer,
	code: async () => (await import("../renderers/code-renderer")).codeRenderer,
	// pdf.js (+ worker) is the ~3 MB bundle (OQ-PV-2) — only fetched here when
	// a PDF is actually opened.
	pdf: async () => (await import("../renderers/pdf-renderer")).pdfRenderer,
	// three.js (+ loaders) is the heavy bundle — only fetched when a 3D model
	// (glTF / GLB / OBJ) is actually opened (9.20.10).
	model: async () => (await import("../renderers/model-renderer")).modelRenderer,
	// RAW reuses the image renderer behind an embedded-JPEG extractor (9.20.11).
	raw: async () => (await import("../renderers/raw-renderer")).rawRenderer,
	// mammoth + xlsx + fflate are heavy — only fetched when an Office file
	// (DOCX / XLSX / PPTX) is actually opened (9.20.9).
	office: async () => (await import("../renderers/office-renderer")).officeRenderer,
	// libheif wasm is heavy — only fetched when a HEIC/HEIF is opened (9.20.8).
	heic: async () => (await import("../renderers/heic-renderer")).heicRenderer,
};
