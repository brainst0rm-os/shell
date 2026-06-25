/**
 * App-side keyboard delivery per
 * §Keyboard handling. Mirrors `apps/files/src/shortcuts.ts`: every
 * keyboard interaction routes through an action id, no raw `e.key`
 * outside this module.
 *
 * Chord syntax matches the shell registry's canonical form
 * (`CmdOrCtrl+K`, `Shift+Enter`) so when the shell's per-renderer
 * shortcut push reaches the SDK, this seed loses to the registered chord.
 */

const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

export const ActionId = {
	GoInbox: "brainstorm.tasks/go-inbox",
	GoToday: "brainstorm.tasks/go-today",
	GoUpcoming: "brainstorm.tasks/go-upcoming",
	NextSurface: "brainstorm.tasks/next-surface",
	PrevSurface: "brainstorm.tasks/prev-surface",
	NextTask: "brainstorm.tasks/next-task",
	PrevTask: "brainstorm.tasks/prev-task",
	ToggleComplete: "brainstorm.tasks/toggle-complete",
	ToggleShowCompleted: "brainstorm.tasks/toggle-show-completed",
	FocusSidebar: "brainstorm.tasks/focus-sidebar",
	FocusContent: "brainstorm.tasks/focus-content",
	FocusSearch: "brainstorm.tasks/focus-search",
	ClearSearch: "brainstorm.tasks/clear-search",
	CloseInspector: "brainstorm.tasks/close-inspector",
	QuickLook: "brainstorm.tasks/quick-look",
	Compose: "brainstorm.tasks/compose",
	CopySelection: "brainstorm.tasks/copy-selection",
	SelectAll: "brainstorm.tasks/select-all",
} as const;

export type ActionId = (typeof ActionId)[keyof typeof ActionId];

const DEFAULT_CHORDS: Record<ActionId, readonly string[]> = {
	[ActionId.GoInbox]: ["CmdOrCtrl+1"],
	[ActionId.GoToday]: ["CmdOrCtrl+2"],
	[ActionId.GoUpcoming]: ["CmdOrCtrl+3"],
	[ActionId.NextSurface]: ["CmdOrCtrl+ArrowDown"],
	[ActionId.PrevSurface]: ["CmdOrCtrl+ArrowUp"],
	[ActionId.NextTask]: ["ArrowDown", "j"],
	[ActionId.PrevTask]: ["ArrowUp", "k"],
	[ActionId.ToggleComplete]: ["Enter", "x"],
	[ActionId.ToggleShowCompleted]: ["CmdOrCtrl+."],
	[ActionId.FocusSidebar]: ["F1"],
	[ActionId.FocusContent]: ["F2"],
	[ActionId.FocusSearch]: ["CmdOrCtrl+f"],
	[ActionId.ClearSearch]: ["Escape"],
	[ActionId.CloseInspector]: ["Escape"],
	[ActionId.QuickLook]: ["CmdOrCtrl+l"],
	[ActionId.Compose]: ["CmdOrCtrl+n"],
	[ActionId.CopySelection]: ["CmdOrCtrl+c"],
	[ActionId.SelectAll]: ["CmdOrCtrl+a"],
};

type Handler = (event: KeyboardEvent) => void;

/** Subscribe an action to a document-level keydown listener. Returns an
 *  unsubscribe. Multiple `bindShortcut` calls for the same id stack — the
 *  most recent one runs first. */
export function bindShortcut(id: ActionId, handler: Handler): () => void {
	const chords = DEFAULT_CHORDS[id];
	if (!chords || chords.length === 0) return noop;

	function onKeydown(event: KeyboardEvent): void {
		if (isTypingTarget(event.target)) {
			// Allow Enter / Escape / arrows through; otherwise let typing
			// targets eat the key. The Tasks app currently has no
			// non-Esc bare-key chords on typing targets, so this guard
			// stays simple.
			const k = event.key;
			if (k !== "Escape" && k !== "Enter" && !k.startsWith("Arrow")) return;
		}
		for (const chord of chords) {
			if (matchesChord(chord, event)) {
				handler(event);
				return;
			}
		}
	}

	document.addEventListener("keydown", onKeydown);
	return () => document.removeEventListener("keydown", onKeydown);
}

function noop(): void {}

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	const tag = target.tagName;
	return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Match a chord string against a `KeyboardEvent`. The chord is a
 *  `+`-separated list of modifiers + a final key, e.g.
 *  `CmdOrCtrl+Shift+K`. Modifiers: `CmdOrCtrl` (Cmd on macOS, Ctrl
 *  elsewhere), `Shift`, `Alt`, `Meta`. Key matching is case-sensitive
 *  for single letters (Shift uppercases `KeyboardEvent.key` so `Mod+a`
 *  becomes `Mod+A` when Shift is held — the chord syntax expects the
 *  Shift-modifier form). */
function matchesChord(chord: string, event: KeyboardEvent): boolean {
	const parts = chord.split("+");
	const key = parts[parts.length - 1] ?? "";
	const mods = new Set(parts.slice(0, -1));
	const cmdLike = IS_MAC ? event.metaKey : event.ctrlKey;
	if (mods.has("CmdOrCtrl") !== cmdLike) return false;
	if (mods.has("Shift") !== event.shiftKey) return false;
	if (mods.has("Alt") !== event.altKey) return false;
	if (mods.has("Meta") !== (IS_MAC ? event.metaKey : event.metaKey)) {
		// `Meta` modifier (in addition to CmdOrCtrl) — rarely used; pass if
		// neither side asserts it. We've already covered Cmd via CmdOrCtrl.
	}
	return event.key === key;
}

export { DEFAULT_CHORDS as _DEFAULT_CHORDS };
