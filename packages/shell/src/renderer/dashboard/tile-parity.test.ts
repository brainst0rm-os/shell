/**
 * Tile-metrics parity: a pinned-object tile and an app tile must present
 * an *identical* tile-block (same tile box, same dot-reserve below it),
 * so the icon→label distance is pixel-identical regardless of which
 * variant renders in a given grid slot. These assertions lock the single
 * source of truth (`grid.ts`) against the CSS that consumes it — a drift
 * here is exactly the regression the user reported (labels sitting closer
 * under pinned objects, oversized emoji).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ICON_DOT_RESERVE_PX, ICON_PIN_GLYPH_RATIO, getIconSize } from "./grid";

const css = readFileSync(fileURLToPath(new URL("./icons-layer.css", import.meta.url)), "utf8");
const appCss = readFileSync(fileURLToPath(new URL("./app-icon.css", import.meta.url)), "utf8");

/** The `--space-*` scale, read from the tokens source of truth so a length
 *  expressed as `var(--space-0_5)` resolves to the same px the runtime injects
 *  (these rules use design tokens for spacing, not raw px). */
const spaceScale: Record<string, number> = (() => {
	const themes = readFileSync(
		fileURLToPath(new URL("../../../../tokens/src/themes.ts", import.meta.url)),
		"utf8",
	);
	const block = themes.slice(themes.indexOf("const space = {"));
	const out: Record<string, number> = {};
	for (const [, key, val] of block.matchAll(/"([0-9_]+)":\s*"(\d+)px"/g)) {
		out[`--space-${key}`] = Number(val);
	}
	return out;
})();

function ruleBlock(source: string, selector: string): string {
	const start = source.indexOf(selector);
	expect(start, `${selector} not found`).toBeGreaterThanOrEqual(0);
	const open = source.indexOf("{", start);
	const close = source.indexOf("}", open);
	return source.slice(open + 1, close);
}

/** Resolve a length declaration to px, accepting either a raw `Npx` value or a
 *  `var(--space-*)` token reference. */
function px(block: string, prop: string): number {
	const raw = block.match(new RegExp(`${prop}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)px`));
	if (raw) return Number(raw[1]);
	const token = block.match(new RegExp(`${prop}\\s*:\\s*var\\((--space-[0-9_]+)\\)`));
	const resolved = token ? spaceScale[token[1] as string] : undefined;
	expect(resolved, `${prop} not found / unresolved in block`).toBeDefined();
	return resolved as number;
}

describe("dashboard tile-block parity", () => {
	it("the pin dot-reserve spacer equals the app running-dot reserve", () => {
		const appDot = ruleBlock(appCss, ".app-icon__dot {");
		const appReserve = px(appDot, "height") + px(appDot, "margin-top");

		const pinReserve = ruleBlock(css, ".dashboard-icons__pin-dot-reserve {");
		const pinReserveTotal = px(pinReserve, "height") + px(pinReserve, "margin-top");

		expect(pinReserveTotal).toBe(appReserve);
		// And both equal the single source of truth in grid.ts.
		expect(appReserve).toBe(ICON_DOT_RESERVE_PX);
		expect(pinReserveTotal).toBe(ICON_DOT_RESERVE_PX);
	});

	it("the pin-block column mirrors the app-icon column gap", () => {
		const appCol = ruleBlock(appCss, ".app-icon {");
		const pinCol = ruleBlock(css, ".dashboard-icons__pin-block {");
		// Both stack tile + dot-reserve with the same flex gap token, so
		// the tile-block height (and thus the gap to the label) matches.
		expect(appCol).toMatch(/flex-direction:\s*column/);
		expect(pinCol).toMatch(/flex-direction:\s*column/);
		const tokenOf = (b: string) => (b.match(/gap:\s*(var\([^)]+\))/) as RegExpMatchArray)[1];
		expect(tokenOf(pinCol)).toBe(tokenOf(appCol));
	});

	it("insets a pinned object's own glyph below the app squircle box size", () => {
		// App glyph artwork has large built-in padding; an emoji image
		// fills its box edge-to-edge, so it must be inset to read at the
		// same optical weight. Ratio must be a real shrink, not ~1.
		expect(ICON_PIN_GLYPH_RATIO).toBeGreaterThan(0.5);
		expect(ICON_PIN_GLYPH_RATIO).toBeLessThan(0.85);

		const { tile } = getIconSize({ w: 96, h: 104 });
		const glyph = Math.round(tile * ICON_PIN_GLYPH_RATIO);
		expect(glyph).toBeLessThan(tile);
		expect(tile - glyph).toBeGreaterThanOrEqual(8);
	});

	it("does not force the inset glyph back to 100% of the tile box", () => {
		const obj = ruleBlock(css, ".dashboard-icons__pin-object {");
		expect(obj).not.toMatch(/width:\s*100%/);
		expect(obj).not.toMatch(/height:\s*100%/);
	});
});
