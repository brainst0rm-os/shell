/**
 * Coerce an arbitrary CSS colour value to the `#rrggbb` form the colour
 * picker seeds from. Expands `#rgb` shorthand; anything the picker can't
 * represent (named colours, `rgba()` with alpha, `var(...)`) falls back to
 * black — the authoritative editor is always the text input, so the picker
 * is a convenience that never corrupts a value the author didn't touch.
 */
export function toColorInputValue(value: string): string {
	const v = value.trim().toLowerCase();
	if (/^#[0-9a-f]{6}$/.test(v)) return v;
	if (/^#[0-9a-f]{3}$/.test(v)) {
		return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
	}
	return "#000000";
}
