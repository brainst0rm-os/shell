/**
 * `captureChord(event)` — translate a live `KeyboardEvent` from the
 * rebinding capture surface into a canonical chord string that the
 * shortcut registry understands.
 *
 * **Mod round-trip (6.10f).** The captured chord uses `Mod` for the
 * primary platform modifier (`Meta` on macOS, `Ctrl` elsewhere) rather
 * than `Cmd` / `Ctrl` / `CmdOrCtrl`. This is the doc-24 canonical
 * cross-platform alias: a chord captured on a Mac with `Cmd+Shift+P`
 * persists as `Mod+Shift+P`, and the same user opening Brainstorm on
 * Windows reads it as `Ctrl+Shift+P` — no second rebind. The
 * `normalizeChord` pass in `main/shortcuts/chord.ts` already collapses
 * `Mod` to `cmdorctrl`, so runtime matching is unchanged.
 *
 * Pure code. Lives in the renderer because it consumes browser-side
 * KeyboardEvents; the round-trip contract (`Mod+...` on the wire) is
 * shared with the main-process registry through the normalize layer.
 *
 * Returns `null` for:
 *   - a pure modifier press (`Shift`, `Cmd`, `Ctrl`, `Alt` alone) — the
 *     capture surface keeps listening until the user adds a key
 *   - an empty / unknown key event
 *   - the special "clear binding" sentinel (caller decides how to
 *     surface — typically Backspace inside capture mode → reset)
 */

/** Single source of truth for what counts as a modifier in capture mode. */
const MODIFIER_KEYS = new Set(["Meta", "Control", "Alt", "Shift", "OS", "Hyper", "Super"]);

/** Semantic keys that round-trip verbatim (the registry matches `event.key`
 *  for these — 6.10a). Listed explicitly so capture doesn't try to
 *  uppercase them or pull them off `event.code`. */
const SEMANTIC_KEYS = new Set([
	"Enter",
	"Escape",
	"Tab",
	"Backspace",
	"Delete",
	"Insert",
	"Home",
	"End",
	"PageUp",
	"PageDown",
	"ArrowUp",
	"ArrowDown",
	"ArrowLeft",
	"ArrowRight",
	" ", // Space — normalized below
	"F1",
	"F2",
	"F3",
	"F4",
	"F5",
	"F6",
	"F7",
	"F8",
	"F9",
	"F10",
	"F11",
	"F12",
]);

/** Wire-level shape of the input we need. A bare object satisfies the
 *  type so capture is unit-testable without a real DOM event. */
export type ChordCaptureInput = {
	readonly key: string;
	readonly code?: string;
	readonly metaKey?: boolean;
	readonly ctrlKey?: boolean;
	readonly altKey?: boolean;
	readonly shiftKey?: boolean;
};

/** Result of a rebind capture. `chord` is the Mod-tokenized canonical
 *  form a `KeyboardEvent` resolved to; `isModifierOnly` flags a pure-
 *  modifier press so the capture surface can stay armed. */
export type ChordCaptureResult =
	| { readonly chord: string; readonly isModifierOnly: false }
	| { readonly chord: null; readonly isModifierOnly: true };

export function captureChord(event: ChordCaptureInput): ChordCaptureResult {
	const rawKey = event.key ?? "";
	if (MODIFIER_KEYS.has(rawKey)) {
		return { chord: null, isModifierOnly: true };
	}

	const keyToken = resolveKeyToken(event);
	if (keyToken === null) {
		return { chord: null, isModifierOnly: true };
	}

	const tokens: string[] = [];
	const isMac =
		typeof navigator !== "undefined" &&
		/mac|iphone|ipad/i.test(navigator.platform ?? navigator.userAgent);
	const metaIsMod = isMac && event.metaKey === true;
	const ctrlIsMod = !isMac && event.ctrlKey === true;
	const ctrlIsExtra = isMac && event.ctrlKey === true;
	const metaIsExtra = !isMac && event.metaKey === true;

	if (metaIsMod || ctrlIsMod) tokens.push("Mod");
	// macOS Control is a separate modifier from Mod (⌘). Windows/Linux Meta
	// is rare but possible (Windows key) — preserve it verbatim.
	if (ctrlIsExtra) tokens.push("Ctrl");
	if (metaIsExtra) tokens.push("Meta");
	if (event.altKey === true) tokens.push("Alt");
	if (event.shiftKey === true) tokens.push("Shift");
	tokens.push(keyToken);

	return { chord: tokens.join("+"), isModifierOnly: false };
}

/** Resolve the key half of the chord. Letters / digits use `event.code`
 *  so the chord stays layout-invariant (a US `Cmd+K` rebound on AZERTY
 *  still records `Mod+K`, matching the 6.10a matcher). Semantic keys use
 *  `event.key`. Returns `null` for events that don't carry a usable key
 *  (rare: dead-key composition / IME). */
function resolveKeyToken(event: ChordCaptureInput): string | null {
	const code = event.code ?? "";

	// Layout-invariant ASCII letters: `KeyA` … `KeyZ` → `"A"` … `"Z"`.
	const letterMatch = code.match(/^Key([A-Z])$/);
	if (letterMatch?.[1]) return letterMatch[1];

	// Layout-invariant ASCII digits: `Digit0` … `Digit9` → `"0"` … `"9"`.
	const digitMatch = code.match(/^Digit([0-9])$/);
	if (digitMatch?.[1]) return digitMatch[1];

	// Numpad digits stay distinct (a user *may* want `Mod+Numpad0`).
	const numpadDigit = code.match(/^Numpad([0-9])$/);
	if (numpadDigit?.[1]) return `Numpad${numpadDigit[1]}`;

	const rawKey = event.key ?? "";
	if (rawKey === "") return null;
	if (rawKey === " ") return "Space";

	if (SEMANTIC_KEYS.has(rawKey)) return rawKey;

	// Punctuation, symbols, and any other single character — uppercase
	// for stability so `?` / `?+Shift` agree, and the registry's
	// canonical-key comparison (`normalizeKey`) round-trips it.
	if (rawKey.length === 1) return rawKey.toUpperCase();

	// Multi-character names not in the semantic set (`Unidentified`,
	// `Process`, dead-key combinations) — refuse rather than guess.
	return null;
}
