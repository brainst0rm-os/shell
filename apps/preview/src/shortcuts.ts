/**
 * App-side keyboard delivery per
 * §Keyboard handling. Mirrors `apps/tasks/src/shortcuts.ts` /
 * `apps/calendar/src/shortcuts.ts`: every keyboard interaction routes
 * through an action id, no raw `e.key` outside this module.
 */

const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

export const ActionId = {
	GoPrev: "brainstorm.preview/go-prev",
	GoNext: "brainstorm.preview/go-next",
	GoFirst: "brainstorm.preview/go-first",
	GoLast: "brainstorm.preview/go-last",
	ToggleInspector: "brainstorm.preview/toggle-inspector",
	// Image renderer (9.20.2). Bound by the image module while mounted +
	// unbound on dispose so they're inert for non-image kinds.
	ZoomIn: "brainstorm.preview/zoom-in",
	ZoomOut: "brainstorm.preview/zoom-out",
	ZoomReset: "brainstorm.preview/zoom-reset",
	ZoomActual: "brainstorm.preview/zoom-actual",
	CycleFit: "brainstorm.preview/cycle-fit",
	// Pan a zoomed image with the arrow keys. Same chords as GoPrev/GoNext
	// by design — the image module binds these with `capture: true` and
	// only consumes the event when the image is actually pannable, so at
	// fit-size the arrows still fall through to file navigation.
	PanLeft: "brainstorm.preview/pan-left",
	PanRight: "brainstorm.preview/pan-right",
	PanUp: "brainstorm.preview/pan-up",
	PanDown: "brainstorm.preview/pan-down",
	// Rotate the image in 90° steps (9.20.8). `[` / `]` are the modifier-free
	// image-viewer convention; per-device view chrome, reset per file.
	RotateLeft: "brainstorm.preview/rotate-left",
	RotateRight: "brainstorm.preview/rotate-right",
	// Mirror the image horizontally / vertically (9.20.8). `h` / `v` are
	// modifier-free, free of other image chords; per-device, reset per file.
	FlipHorizontal: "brainstorm.preview/flip-horizontal",
	FlipVertical: "brainstorm.preview/flip-vertical",
	// PDF page nav (9.20.5). Arrow/Up-Down page within a multi-page document;
	// the renderer binds these `capture: true` and only consumes them when the
	// PDF has >1 page, so a single-page PDF lets the arrows page files.
	PdfPrevPage: "brainstorm.preview/pdf-prev-page",
	PdfNextPage: "brainstorm.preview/pdf-next-page",
	// 3D model reset-view (9.20.10). `0` recentres the camera, the modifier-free
	// "home" convention; bound only while the model renderer is mounted.
	ModelResetView: "brainstorm.preview/model-reset-view",
} as const;

export type ActionId = (typeof ActionId)[keyof typeof ActionId];

const DEFAULT_CHORDS: Record<ActionId, readonly string[]> = {
	// PageUp / PageDown also walk the gallery (9.20.6). They have no
	// image-pan twin, so they navigate files even over a zoomed image —
	// the deliberate escape hatch when Arrow keys are panning.
	[ActionId.GoPrev]: ["ArrowLeft", "PageUp"],
	[ActionId.GoNext]: ["ArrowRight", "PageDown"],
	[ActionId.GoFirst]: ["Home"],
	[ActionId.GoLast]: ["End"],
	[ActionId.ToggleInspector]: ["i", "I"],
	[ActionId.ZoomIn]: ["=", "+"],
	[ActionId.ZoomOut]: ["-", "_"],
	[ActionId.ZoomReset]: ["0"],
	[ActionId.ZoomActual]: ["1"],
	[ActionId.CycleFit]: ["f", "F"],
	[ActionId.PanLeft]: ["ArrowLeft"],
	[ActionId.PanRight]: ["ArrowRight"],
	[ActionId.PanUp]: ["ArrowUp"],
	[ActionId.PanDown]: ["ArrowDown"],
	[ActionId.RotateLeft]: ["["],
	[ActionId.RotateRight]: ["]"],
	[ActionId.FlipHorizontal]: ["h", "H"],
	[ActionId.FlipVertical]: ["v", "V"],
	[ActionId.PdfPrevPage]: ["ArrowLeft", "ArrowUp"],
	[ActionId.PdfNextPage]: ["ArrowRight", "ArrowDown"],
	[ActionId.ModelResetView]: ["0"],
};

type Handler = (event: KeyboardEvent) => void;

export type BindOptions = {
	/** Register on the capture phase so this handler runs *before* any
	 *  bubble-phase listener bound earlier (e.g. the host's file-nav
	 *  shortcuts). The handler can then `stopPropagation()` to win the
	 *  chord, or let the event through to fall back to the host. */
	capture?: boolean;
};

export function bindShortcut(
	id: ActionId,
	handler: Handler,
	options: BindOptions = {},
): () => void {
	const chords = DEFAULT_CHORDS[id];
	if (!chords || chords.length === 0) return noop;
	const capture = options.capture ?? false;

	function onKeydown(event: KeyboardEvent): void {
		if (isTypingTarget(event.target)) return;
		for (const chord of chords) {
			if (matchesChord(chord, event)) {
				handler(event);
				return;
			}
		}
	}

	document.addEventListener("keydown", onKeydown, capture);
	return () => document.removeEventListener("keydown", onKeydown, capture);
}

function noop(): void {}

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	const tag = target.tagName;
	return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function matchesChord(chord: string, event: KeyboardEvent): boolean {
	const parts = chord.split("+");
	const key = parts[parts.length - 1] ?? "";
	const mods = new Set(parts.slice(0, -1));
	const cmdLike = IS_MAC ? event.metaKey : event.ctrlKey;
	if (mods.has("CmdOrCtrl") !== cmdLike) return false;
	if (mods.has("Shift") !== event.shiftKey) return false;
	if (mods.has("Alt") !== event.altKey) return false;
	return event.key === key;
}

export { DEFAULT_CHORDS as _DEFAULT_CHORDS };
