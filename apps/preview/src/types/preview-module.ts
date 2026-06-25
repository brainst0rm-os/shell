/**
 * `PreviewModule` — the contract every per-kind renderer satisfies.
 *
 * Architecturally a thin sandboxed shell whose render-pane embeds a per-kind
 * module. Stage 9.20.1 lands only the type contract + the registry
 * placeholder; renderer implementations land in 9.20.2 (image), 9.20.3
 * (audio + video), 9.20.4 (code), 9.20.5 (PDF). Markdown + plain-text
 * arrive in the 9.20.1.5 preview drop.
 *
 * **Why a module contract rather than per-kind components?** Lazy loading
 * is the dominant performance lever — PDF.js alone is ~3 MB (OQ-PV-2).
 * Treating each renderer as a dynamic-import-able module lets Preview's
 * cold-start stay tight regardless of which renderers ship in v1.
 *
 * **Why pure host-controlled mount/unmount?** Each renderer owns its DOM
 * subtree; the host owns chrome (header, inspector pane, slideshow nav).
 * `dispose()` is mandatory so renderers can revoke object URLs, abort
 * fetches, and detach listeners — the host calls it on every navigation.
 */

import type { PreviewKind } from "./preview-kind";

/** What a renderer is asked to display. `bytes` is the raw payload;
 *  `url` is a brainstorm:// or blob: URL that the renderer can hand to a
 *  native element (img.src, video.src) — exactly one of the two is
 *  set per [[file-handle-shape]]. */
export type PreviewSource =
	| { kind: "url"; url: string; mime: string; sizeBytes: number | null }
	| { kind: "bytes"; bytes: Uint8Array; mime: string };

/** Metadata the host shows in the inspector pane. Per-kind enrichment
 *  (EXIF, ID3, PDF page count) is appended by `extractMetadata()`. */
export type PreviewFileInfo = {
	name: string;
	mime: string;
	sizeBytes: number | null;
	modifiedAt: number | null;
};

export type PreviewMountContext = {
	source: PreviewSource;
	file: PreviewFileInfo;
	host: HTMLElement;
	/** Open a web URL externally (PDF link annotations → the browser app via
	 *  the `open` intent). Absent in tests / when the host has no intents
	 *  service — renderers then render links inert. */
	openExternalUrl?: (url: string) => void;
};

/** A loaded renderer instance. `dispose()` is called by the host on
 *  unmount; renderers must release every resource they hold (object
 *  URLs, AbortControllers, audio buffers, PDF documents). */
export type PreviewInstance = {
	dispose(): void;
};

export type PreviewModule = {
	readonly kind: PreviewKind;
	/** Mount the renderer into `host`. The host element is wiped before
	 *  mount; the module owns its subtree until `dispose()` is called. */
	mount(context: PreviewMountContext): Promise<PreviewInstance> | PreviewInstance;
	/** Per-kind metadata extraction. Optional — when omitted, the
	 *  inspector falls back to filename / size / modified date only. */
	extractMetadata?(source: PreviewSource): Promise<Record<string, string>> | Record<string, string>;
};

/** Dynamic-import loader. Renderer bundles are kept off the cold-start
 *  path so launching Preview for a 12 KB markdown file doesn't pay
 *  PDF.js's ~3 MB tax. Returns `null` when no renderer is registered
 *  for the kind — the host renders an "unsupported format" pane. */
export type PreviewModuleLoader = () => Promise<PreviewModule>;
