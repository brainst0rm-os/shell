/**
 * Event colour presets — the curated palette the detail surface offers
 * for `Event.colorHint`. A `null` colorHint means "wear the source legend
 * colour" (Events default to the purple from `colorForSourceKey`); picking a
 * preset stores its CSS value verbatim, so the chip's `--chip-color`
 * honours it everywhere with no extra plumbing.
 *
 * Keys are stable identifiers (for the swatch's a11y label + selected-state
 * match); values are the CSS colours actually written to `colorHint`.
 */

export type EventColorPreset = {
	/** Stable id — feeds the swatch aria-label key + selected-state match. */
	key: string;
	/** The CSS colour written to `Event.colorHint` when picked. */
	value: string;
};

export const EVENT_COLOR_PRESETS: readonly EventColorPreset[] = Object.freeze([
	{ key: "graphite", value: "#6b7280" },
	{ key: "blue", value: "#3b82f6" },
	{ key: "purple", value: "#7c83ff" },
	{ key: "teal", value: "#14b8a6" },
	{ key: "green", value: "#5da27e" },
	{ key: "amber", value: "#d49241" },
	{ key: "red", value: "#dc5b5b" },
	{ key: "pink", value: "#c66a8c" },
]);

/** Normalise a stored colorHint to a non-empty CSS string, or `null`. */
export function normalizeColorHint(raw: unknown): string | null {
	return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
}

/** The preset whose value matches `colorHint`, or `null` for a custom /
 *  absent colour (the picker then highlights nothing). */
export function presetForColor(colorHint: string | null): EventColorPreset | null {
	if (colorHint === null) return null;
	return EVENT_COLOR_PRESETS.find((p) => p.value === colorHint) ?? null;
}
