/**
 * `PreviewKind` — closed enumeration of the renderer modules Preview
 * dispatches on. The MIME → kind mapping is centralised in
 * `previewKindFor(mime)` so the manifest's `registrations.intents`
 * (broad MIME list, per §9.20) and the
 * runtime module registry agree on which renderer wins.
 *
 * v1 ships first-party preview blocks for the seven kinds below. Third-
 * party kinds (3D / RAW / Office) land post-v1 via the marketplace
 * reusing the same block-frame infra from 9.4 / 9.5; their MIME types
 * will register additional `PreviewKind` values when they arrive.
 *
 * Per [[enums-not-string-constants]] this is a TS string enum, so
 * `case PreviewKind.Image:` is the canonical reference style — no
 * `case "image":` literals anywhere in the codebase.
 */

export enum PreviewKind {
	Image = "image",
	Video = "video",
	Audio = "audio",
	Text = "text",
	Markdown = "markdown",
	Code = "code",
	Pdf = "pdf",
	Model = "model",
	Raw = "raw",
	Office = "office",
	Heic = "heic",
}
