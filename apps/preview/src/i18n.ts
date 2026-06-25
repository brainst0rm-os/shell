/**
 * Preview app i18n manifest. Per docs/foundations/35-code-conventions.md
 * §Localization every user-visible string flows through the shared
 * app-side `t()` (`createT` from `@brainstorm/sdk/i18n`) over this
 * default-English manifest — no bare literals in app.ts / inspector.ts.
 *
 * `{name}` placeholders are interpolated by `createT`. Keys are stable
 * identifiers; a localised build supplies a `Partial<typeof MANIFEST>`
 * override layer (not wired in v1 — English only).
 */

import { type TParams, createT, plural as sdkPlural } from "@brainstorm/sdk/i18n";

export const PREVIEW_I18N = {
	"app.title": "Preview",
	"app.moreActions": "More actions",
	"nav.prev": "Previous file",
	"nav.next": "Next file",
	"menu.showInspector": "Show inspector (I)",
	"menu.hideInspector": "Hide inspector (I)",
	"sidebar.show": "Show files",
	"sidebar.hide": "Hide files",
	"sidebar.region": "Files",
	"sidebar.filterPlaceholder": "Filter files…",
	"sidebar.empty": "No files in this vault yet",
	"sidebar.noMatches": "No files match",
	"menu.saveCopy": "Save a copy…",
	"menu.saveDialogTitle": "Save a copy",
	"counter.position": "{index} of {total}",
	"counter.empty": "0 of 0",
	"stage.noFileSelected": "Nothing to preview",
	"stage.noFileSelectedHint":
		"Open a file or image from Files, or press Space on any object to Quick Look it here.",
	"stage.noPreviewFor": "No preview for {mime}",
	"stage.rendererNotWired": "Renderer for {kind} not yet wired",
	"stage.rendererFailed": "Renderer failed: {detail}",
	"stage.unavailable": "Preview unavailable",
	"context.fromNote": "From note:",
	"context.fromFolder": "From folder:",
	"context.selection": "Selection:",
	"context.fromGeneric": "From:",
	"context.untitledNote": "Untitled note",
	"context.untitledFolder": "Untitled folder",
	"context.itemCount.one": "{count} item",
	"context.itemCount.other": "{count} items",
	"image.zoom": "Image zoom",
	"image.zoomOut": "Zoom out",
	"image.zoomIn": "Zoom in",
	"image.zoomOutTitle": "Zoom out  −",
	"image.zoomInTitle": "Zoom in  +",
	"image.fitMode": "Fit mode",
	"image.fitModeTitle": "Fit mode (F) · 0 fit · 1 actual size · drag or arrows to pan",
	"image.fitModeAria": "Fit mode: {mode}",
	"image.fill": "Fill",
	"image.fit": "Fit",
	"image.rotateLeft": "Rotate left",
	"image.rotateRight": "Rotate right",
	"image.rotateLeftTitle": "Rotate left ([)",
	"image.rotateRightTitle": "Rotate right (])",
	"image.flipHorizontal": "Flip horizontal",
	"image.flipVertical": "Flip vertical",
	"image.flipHorizontalTitle": "Flip horizontal (H)",
	"image.flipVerticalTitle": "Flip vertical (V)",
	"pdf.toolbar": "PDF navigation",
	"pdf.prevPage": "Previous page",
	"pdf.prevPageTitle": "Previous page (←)",
	"pdf.nextPage": "Next page",
	"pdf.nextPageTitle": "Next page (→)",
	"pdf.zoomIn": "Zoom in",
	"pdf.zoomOut": "Zoom out",
	"pdf.fit": "Fit page",
	"model.toolbar": "3D view",
	"model.resetView": "Reset view",
	"model.resetViewTitle": "Reset view (0)",
	"model.unsupported": "Unsupported 3D format",
	"model.noWebgl": "3D preview needs WebGL, which isn't available here",
	"raw.noPreview": "This RAW file has no embedded preview to show",
	"office.unsupported": "Unsupported Office format",
	"office.sheets": "Sheets",
	"office.slideNum": "Slide {num}",
	"office.emptyDoc": "This document has no readable content",
	"office.emptySheet": "This sheet is empty",
	"office.emptyDeck": "This presentation has no slides",
	"heic.decodeFailed": "Couldn't decode this HEIC image",
	"inspector.title": "Details",
	"inspector.empty": "No file selected",
	"inspector.type": "Type",
	"inspector.size": "Size",
	"inspector.modified": "Modified",
	"inspector.properties": "Properties",
	"inspector.noProperties": "No properties yet",
	"inspector.addProperty": "Add property",
	"inspector.removeProperty": "Remove {name}",
} as const;

export type PreviewI18nKey = keyof typeof PREVIEW_I18N;

export const t = createT(PREVIEW_I18N);

/** Catalog-bound plural — picks `<base>.one` / `<base>.other`. The count
 *  selection lives in the shared SDK helper, never in component code. */
export const plural = (
	count: number,
	oneKey: PreviewI18nKey,
	otherKey: PreviewI18nKey,
	params?: TParams,
): string => sdkPlural(t, count, oneKey, otherKey, params);
