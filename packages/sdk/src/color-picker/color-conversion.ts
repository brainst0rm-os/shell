/**
 * HSV ⇄ hex colour maths for the 2D saturation×value picker. HSV is the
 * natural space for the picker: the area's horizontal axis maps to S and its
 * vertical to V at a fixed hue, while the slider drives H. Hex is what every
 * consumer stores and what the text input round-trips, so the two helpers are
 * exact inverses for any in-gamut value.
 */

export type Hsv = { h: number; s: number; v: number };

export function hsvToHex(h: number, s: number, v: number): string {
	const sat = s / 100;
	const val = v / 100;
	const c = val * sat;
	const hh = ((((h % 360) + 360) % 360) / 60) as number;
	const x = c * (1 - Math.abs((hh % 2) - 1));
	let r = 0;
	let g = 0;
	let b = 0;
	if (hh < 1) {
		r = c;
		g = x;
	} else if (hh < 2) {
		r = x;
		g = c;
	} else if (hh < 3) {
		g = c;
		b = x;
	} else if (hh < 4) {
		g = x;
		b = c;
	} else if (hh < 5) {
		r = x;
		b = c;
	} else {
		r = c;
		b = x;
	}
	const m = val - c;
	const channel = (n: number): string =>
		Math.round((n + m) * 255)
			.toString(16)
			.padStart(2, "0");
	return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export function hexToHsv(hex: string): Hsv | null {
	const normalized = normalizeHex(hex);
	if (!normalized) return null;
	const int = Number.parseInt(normalized.slice(1), 16);
	const r = ((int >> 16) & 0xff) / 255;
	const g = ((int >> 8) & 0xff) / 255;
	const b = (int & 0xff) / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	let h = 0;
	if (d > 0) {
		if (max === r) h = ((g - b) / d) % 6;
		else if (max === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	const s = max === 0 ? 0 : d / max;
	return { h: Math.round(h), s: Math.round(s * 100), v: Math.round(max * 100) };
}

/** Coerce `#rgb` / `#rrggbb` (case-insensitive, leading `#` optional) to a
 *  canonical lowercase `#rrggbb`; returns null for anything the picker can't
 *  represent (named colours, `rgba()` with alpha, `var(...)`). */
export function normalizeHex(value: string): string | null {
	const v = value.trim().toLowerCase();
	const six = /^#?([0-9a-f]{6})$/.exec(v);
	if (six?.[1]) return `#${six[1]}`;
	const three = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
	const r = three?.[1];
	const g = three?.[2];
	const b = three?.[3];
	if (r && g && b) return `#${r}${r}${g}${g}${b}${b}`;
	return null;
}
