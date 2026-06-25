/**
 * Regenerate every first-party `apps/<dir>/icon.svg` as a *transparent*,
 * glyph-only tile: just the app's glyph filled in its brand hue, on no
 * background. The tile itself (its frosted surface, gloss sheen, edge and
 * shadow) is composed at runtime in `app-icon.css`, so the icon follows the
 * active theme and the wallpaper blurs through it. The brand hues in
 * `app-icon-art.ts` are already tuned to read on the frosted tile, so the hex
 * is used as-is — no recolouring here.
 *
 * Glyph weight is normalised by the glyph's real *stroke width*, not its
 * bounding box. The art is filled paths that *depict* strokes, and it comes
 * from two families (Material-24, stroke ≈2u; Phosphor-256, stroke ≈16u) with
 * different stroke-to-size ratios. Normalising by bounding box (the previous
 * approach) made every glyph the same overall size but left the *line weight*
 * varying by 1.6× across the suite — the resize factor rode straight onto the
 * baked-in stroke, so dense glyphs scaled up read heavy and sparse ones read
 * thin. We measure each glyph's source stroke in headless Chromium
 * (2·area/perimeter) and scale it so its stroke is exactly `GLYPH_STROKE` in
 * the 200×200 tile, centred at the tile centre. Every tile now reads at one
 * line weight.
 *
 * The trade-off: with stroke pinned, overall glyph *extent* varies (~1.7×) —
 * Phosphor glyphs, having a thinner stroke-to-size ratio, render larger than
 * Material ones. That is the correct optical priority: mismatched line weight
 * reads as "different icon set", a size delta reads as "more/less detail". Use
 * `GLYPH_OPTICAL_SCALE` to nudge any individual outlier.
 *
 * The single colour decision per app is the brand hue in
 * `packages/shell/src/shared/app-icon-art.ts`. The glyph art (its `<path>`)
 * is read from the current icon.svg — this only restyles + resizes, never
 * invents geometry.
 *
 * Run: bun scripts/build-app-icons.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { APP_ICON_NEON } from "../packages/shell/src/shared/app-icon-art";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPS_DIR = join(REPO_ROOT, "apps");

/** App id → source directory under `apps/`. */
const APP_DIRS: Readonly<Record<string, string>> = {
	"io.brainstorm.notes": "notes",
	"io.brainstorm.files": "files",
	"io.brainstorm.database": "database",
	"io.brainstorm.graph": "graph",
	"io.brainstorm.tasks": "tasks",
	"io.brainstorm.calendar": "calendar",
	"io.brainstorm.journal": "journal",
	"io.brainstorm.preview": "preview",
	"io.brainstorm.code-editor": "code-editor",
	"io.brainstorm.whiteboard": "whiteboard",
	"io.brainstorm.bookmarks": "bookmarks",
	"io.brainstorm.theme-editor": "theme-editor",
	"io.brainstorm.books": "books",
	"io.brainstorm.contacts": "contacts",
	"io.brainstorm.form-designer": "form-designer",
	"io.brainstorm.automations": "automations",
	"io.brainstorm.mailbox": "mailbox",
	"io.brainstorm.chat": "chat",
	"io.brainstorm.browser": "browser",
	"io.brainstorm.agent": "agent",
};

type Box = { x: number; y: number; width: number; height: number };

/** Target glyph stroke width, in the 200×200 tile space. Every glyph is scaled
 *  (one uniform scale per glyph) so its measured source stroke maps to this, so
 *  this knob sets the whole suite's size + weight at once — lower = smaller +
 *  lighter glyphs, uniformly. Dropped 7.2 → 6.0 (~17% smaller): the stroke-
 *  normalised set read too large on the frosted tile. */
const GLYPH_STROKE = 6.0;

/** Per-app optical correction (multiplies the stroke-normalised scale, so it
 *  trades a little stroke for size on that one tile). With stroke now
 *  normalised directly there are no systematic outliers to correct — this is
 *  the knob for a one-off glyph that reads too big/small. Default 1. */
const GLYPH_OPTICAL_SCALE: Readonly<Record<string, number>> = {};

function round(n: number): number {
	return Math.round(n * 1000) / 1000;
}

function extractPath(svg: string): string {
	const path = svg.match(/<path d="([^"]+)"/);
	if (!path?.[1]) throw new Error("could not extract glyph path");
	return path[1];
}

/** Transform that scales the glyph so its measured source stroke maps to
 *  `GLYPH_STROKE` (times any per-app optical correction) and centres its bbox
 *  on the tile centre (100, 100). */
function normalizeTransform(box: Box, stroke: number, optical: number): string {
	const s = (GLYPH_STROKE * optical) / stroke;
	const cx = box.x + box.width / 2;
	const cy = box.y + box.height / 2;
	return `translate(${round(100 - s * cx)} ${round(100 - s * cy)}) scale(${round(s)})`;
}

function glyphSvg(hex: string, path: string, box: Box, stroke: number, optical: number): string {
	const t = normalizeTransform(box, stroke, optical);
	// Transparent background — the frosted tile, gloss and shadow are composed
	// at runtime in app-icon.css. Just the glyph, in the brand hue, centred and
	// normalised to one size across the suite.
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
	<g transform="${t}" fill="${hex}"><path d="${path}"/></g>
</svg>
`;
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(
	'<canvas id="c" width="512" height="512"></canvas><svg id="m" xmlns="http://www.w3.org/2000/svg"></svg>',
);

async function bbox(path: string): Promise<Box> {
	return page.evaluate((d) => {
		const NS = "http://www.w3.org/2000/svg";
		const svg = document.getElementById("m") as unknown as SVGSVGElement;
		const p = document.createElementNS(NS, "path");
		p.setAttribute("d", d);
		svg.appendChild(p);
		const b = p.getBBox();
		p.remove();
		return { x: b.x, y: b.y, width: b.width, height: b.height };
	}, path);
}

/** Source-unit stroke width of a filled "stroke" glyph, estimated as
 *  2·area/perimeter (area from rasterising the fill, perimeter from the path
 *  outline length). For a uniform stroke of width w and centreline length L,
 *  area ≈ wL and the outline ≈ 2L, so 2·area/outline ≈ w. */
async function strokeWidth(path: string): Promise<number> {
	return page.evaluate((d) => {
		const NS = "http://www.w3.org/2000/svg";
		const svg = document.getElementById("m") as unknown as SVGSVGElement;
		const p = document.createElementNS(NS, "path");
		p.setAttribute("d", d);
		svg.appendChild(p);
		const b = p.getBBox();
		const outline = p.getTotalLength();
		p.remove();

		const R = 512;
		const cv = document.getElementById("c") as HTMLCanvasElement;
		const ctx = cv.getContext("2d");
		if (!ctx) throw new Error("no 2d context");
		ctx.clearRect(0, 0, R, R);
		const extent = Math.max(b.width, b.height);
		const s = (R * 0.9) / extent;
		ctx.setTransform(
			s,
			0,
			0,
			s,
			(R - s * (b.x * 2 + b.width)) / 2,
			(R - s * (b.y * 2 + b.height)) / 2,
		);
		ctx.fillStyle = "#000";
		ctx.fill(new Path2D(d), "nonzero");
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		const px = ctx.getImageData(0, 0, R, R).data;
		let filled = 0;
		for (let i = 3; i < px.length; i += 4) if ((px[i] ?? 0) > 10) filled += 1;
		const area = filled / (s * s);
		return (2 * area) / outline;
	}, path);
}

let count = 0;
for (const [appId, dir] of Object.entries(APP_DIRS)) {
	const neon = APP_ICON_NEON[appId];
	if (!neon) throw new Error(`no neon colour for ${appId}`);
	const file = join(APPS_DIR, dir, "icon.svg");
	const path = extractPath(readFileSync(file, "utf8"));
	const box = await bbox(path);
	const stroke = await strokeWidth(path);
	writeFileSync(file, glyphSvg(neon, path, box, stroke, GLYPH_OPTICAL_SCALE[appId] ?? 1));
	count += 1;
}

await browser.close();
console.log(`Regenerated ${count} app icons.`);
