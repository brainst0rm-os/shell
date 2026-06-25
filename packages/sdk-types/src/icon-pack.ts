/**
 * `brainstorm/IconPack/v1` — the mapping from semantic icon names
 * (`save`, `settings`, `entity.note`, `vocab.color.red`) to SVG content
 * (docs/shell/13-frontend-stack.md §Icon packs). One of the three
 * composable theme pieces (TokenSet + **IconPack** + Typography); the
 * theme-editor (9.9) picks one, the `<Icon name>` component / `useIcon`
 * hook / pack-resolver (Stage 8.6 render half, renderer-resident)
 * resolve a name through the active pack at render time.
 *
 * This module is the dependency-free **contract + canonical-name
 * registry** half of 8.6: the entity shape + style enum + the
 * shell-curated canonical name namespace + the namespace classifier
 * (the doc's hard rule — apps cannot invent canonical names, only
 * `<app-id>/<name>` app-scoped ones) + validators + a defensive
 * name→svg resolver. Near-leaf — only the shared `enum-guard` leaf is
 * imported — barrel-re-exported with no cycle.
 *
 * It ships **no SVG glyph payloads** — Phosphor's glyphs are pulled
 * into the renderer source tree on demand via the shadcn registry (doc
 * 13 / OQ-71), never bundled here; this module only knows *names* and
 * the *shape* a pack must have. OQ-71 resolved (Phosphor default);
 * OQ-72 (raster fallbacks at tiny sizes) non-blocking for this half.
 */

import { enumGuard } from "./enum-guard";
import { isIconPackSvgSafe, sanitizeIconPackSvg } from "./icon-pack-sanitizer";

export const ICON_PACK_TYPE_URL = "brainstorm/IconPack/v1";

/** Visual style of a pack (doc 13 §Icon packs `metadata.style`). */
export enum IconPackStyle {
	Line = "line",
	Solid = "solid",
	Duotone = "duotone",
	Colored = "colored",
	HandDrawn = "hand-drawn",
}

export const ICON_PACK_STYLES = Object.freeze([
	IconPackStyle.Line,
	IconPackStyle.Solid,
	IconPackStyle.Duotone,
	IconPackStyle.Colored,
	IconPackStyle.HandDrawn,
]) as readonly IconPackStyle[];

/** One glyph entry — the raw SVG markup the renderer injects (the
 *  shell/theme-store validation does SVG sanitisation; this contract
 *  only requires it be present + a string). */
export type IconGlyph = { svg: string };

export type IconPackMetadata = { style: IconPackStyle; weight?: string };

/**
 * The IconPack entity payload (`properties` of a
 * `brainstorm/IconPack/v1` object). `icons` keys are canonical or
 * app-scoped names; `fallback` is the name rendered when a requested
 * name isn't in the pack.
 */
export type IconPackDef = {
	name: string;
	version: string;
	license: string;
	metadata: IconPackMetadata;
	icons: Record<string, IconGlyph>;
	fallback: string;
};

/**
 * The shell-curated, versioned canonical icon-name registry (doc 13
 * §Icon packs decision: "shell-curated and versioned; adding new
 * canonical names is a shell-release decision"). This is the **v1
 * starter set** — the names first-party UI references; it grows only by
 * shell release (bump `CANONICAL_ICON_REGISTRY_VERSION`). Apps cannot
 * invent canonical names at runtime — they use an app-scoped
 * `<app-id>/<name>` instead (see `isAppScopedIconName`). `entity.*` /
 * `vocab.color.*` are open dotted sub-namespaces validated by pattern
 * rather than enumerated exhaustively (a new entity type must not
 * require a shell release just to have an icon name).
 */
export const CANONICAL_ICON_REGISTRY_VERSION = 1;

export const CANONICAL_ICON_NAMES = Object.freeze([
	// Core actions / chrome
	"save",
	"settings",
	"trash",
	"close",
	"search",
	"add",
	"remove",
	"edit",
	"copy",
	"paste",
	"cut",
	"undo",
	"redo",
	"more",
	"menu",
	"check",
	"chevron-up",
	"chevron-down",
	"chevron-left",
	"chevron-right",
	"arrow-up",
	"arrow-down",
	"arrow-left",
	"arrow-right",
	"external-link",
	"link",
	"pin",
	"star",
	"filter",
	"sort",
	"refresh",
	"download",
	"upload",
	"share",
	"info",
	"warning",
	"error",
	"success",
	"lock",
	"unlock",
	"eye",
	"eye-off",
	"calendar",
	"clock",
	"tag",
	"folder",
	"file",
	"image",
	"questionmark",
]) as readonly string[];

const CANONICAL_SET = new Set(CANONICAL_ICON_NAMES);

// `entity.<type>` and `vocab.color.<name>` are canonical *sub-namespaces*
// (open by pattern — a `<segment>(.<segment>)*` tail, lowercase / digits
// / hyphen, so a new entity type doesn't need a shell release).
const ENTITY_NAME = /^entity\.[a-z0-9]+(?:[-.][a-z0-9]+)*$/;
const VOCAB_COLOR_NAME = /^vocab\.color\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
// App-scoped: `<reverse-dns-app-id>/<icon-name>` (doc 13: apps register
// names only under their own id). One slash; both sides non-empty; the
// id segment looks like a reverse-DNS-ish token, the name a dotted slug.
const APP_SCOPED_NAME = /^[a-z0-9]+(?:[.-][a-z0-9]+)+\/[a-z0-9]+(?:[-.][a-z0-9]+)*$/;

/** Is `name` a shell-curated canonical name (a registry member or a
 *  member of the open `entity.*` / `vocab.color.*` sub-namespaces)? */
export function isCanonicalIconName(name: unknown): boolean {
	if (typeof name !== "string" || name.length === 0) return false;
	return CANONICAL_SET.has(name) || ENTITY_NAME.test(name) || VOCAB_COLOR_NAME.test(name);
}

/** Is `name` a valid app-scoped name (`<app-id>/<icon-name>`)? Apps may
 *  only register names under their own id (doc 13 hard rule). */
export function isAppScopedIconName(name: unknown): boolean {
	return typeof name === "string" && APP_SCOPED_NAME.test(name);
}

/** Is `name` referenceable at all — canonical or app-scoped? A name
 *  that is neither is invalid (an app trying to invent a bare canonical
 *  name, the rejected case). */
export function isReferenceableIconName(name: unknown): boolean {
	return isCanonicalIconName(name) || isAppScopedIconName(name);
}

export const isIconPackStyle = enumGuard(ICON_PACK_STYLES);

/**
 * The SVG to actually render for `name` against `pack`: the pack's
 * glyph for the name, else the pack's `fallback` glyph, else `null`
 * (the renderer then shows nothing rather than throwing). Never throws;
 * tolerates loosely-typed / partial pack data — the "always render
 * something (or cleanly nothing)" principle applied to icons.
 *
 * The returned markup is **sanitized** (`sanitizeIconPackSvg`) — this is
 * the chokepoint every load path to the renderer's
 * `dangerouslySetInnerHTML` / `innerHTML` sink flows through, so even a
 * pack loaded directly (not through `validateIconPack` at install) can
 * never inject active content into a renderer.
 */
export function resolveIconSvg(pack: IconPackDef | null | undefined, name: string): string | null {
	const direct = pack?.icons?.[name]?.svg;
	if (typeof direct === "string" && direct.length > 0) return sanitizeIconPackSvg(direct);
	const fb = pack?.fallback;
	if (typeof fb === "string" && fb.length > 0) {
		const fbSvg = pack?.icons?.[fb]?.svg;
		if (typeof fbSvg === "string" && fbSvg.length > 0) return sanitizeIconPackSvg(fbSvg);
	}
	return null;
}

/** Stable codes for IconPack validation failures (enum, not bare
 *  literals, per the no-string-discriminator convention). */
export enum IconPackIssueCode {
	EmptyName = "empty-name",
	EmptyVersion = "empty-version",
	EmptyLicense = "empty-license",
	InvalidStyle = "invalid-style",
	NoIcons = "no-icons",
	InvalidIconName = "invalid-icon-name",
	EmptyGlyph = "empty-glyph",
	UnsafeGlyph = "unsafe-glyph",
	EmptyFallback = "empty-fallback",
	FallbackNotInPack = "fallback-not-in-pack",
}

export type IconPackIssue = { code: IconPackIssueCode; message: string; iconName?: string };

/**
 * Validate an `IconPackDef`. Returns every issue (`[]` ⇒ valid) so the
 * theme editor / theme-store validator surfaces them at once. Checks
 * non-blank name/version/license; a valid `style`; a non-empty `icons`
 * map whose every key is a referenceable name (canonical or
 * app-scoped — never an invented bare canonical) and whose every glyph
 * has non-empty `svg`; and a `fallback` that names a glyph the pack
 * actually defines (so `resolveIconSvg` always has a real fallback).
 *
 * Glyph SVG is also scanned for active-content (XSS) vectors
 * (`isIconPackSvgSafe`); an unsafe glyph is an `UnsafeGlyph` issue so the
 * install/save gate blocks the pack — the same posture the sibling
 * StylePack CSS validator takes.
 */
export function validateIconPack(pack: IconPackDef): IconPackIssue[] {
	const issues: IconPackIssue[] = [];
	if (typeof pack.name !== "string" || pack.name.trim().length === 0) {
		issues.push({ code: IconPackIssueCode.EmptyName, message: "Icon pack name is empty." });
	}
	if (typeof pack.version !== "string" || pack.version.trim().length === 0) {
		issues.push({ code: IconPackIssueCode.EmptyVersion, message: "Icon pack version is empty." });
	}
	if (typeof pack.license !== "string" || pack.license.trim().length === 0) {
		issues.push({ code: IconPackIssueCode.EmptyLicense, message: "Icon pack license is empty." });
	}
	if (!pack.metadata || !isIconPackStyle(pack.metadata.style)) {
		issues.push({
			code: IconPackIssueCode.InvalidStyle,
			message: `Unknown icon-pack style "${String(pack.metadata?.style)}".`,
		});
	}

	const icons = pack.icons;
	if (!icons || typeof icons !== "object" || Object.keys(icons).length === 0) {
		issues.push({ code: IconPackIssueCode.NoIcons, message: "Icon pack defines no icons." });
		return issues;
	}
	for (const [iconName, glyph] of Object.entries(icons)) {
		if (!isReferenceableIconName(iconName)) {
			issues.push({
				code: IconPackIssueCode.InvalidIconName,
				message: `Icon name "${iconName}" is neither a canonical name nor a valid app-scoped (<app-id>/<name>) one.`,
				iconName,
			});
		}
		if (!glyph || typeof glyph.svg !== "string" || glyph.svg.trim().length === 0) {
			issues.push({
				code: IconPackIssueCode.EmptyGlyph,
				message: `Icon "${iconName}" has an empty SVG.`,
				iconName,
			});
		} else if (!isIconPackSvgSafe(glyph.svg)) {
			issues.push({
				code: IconPackIssueCode.UnsafeGlyph,
				message: `Icon "${iconName}" SVG contains active content (script/handler/external reference).`,
				iconName,
			});
		}
	}

	if (typeof pack.fallback !== "string" || pack.fallback.trim().length === 0) {
		issues.push({
			code: IconPackIssueCode.EmptyFallback,
			message: "Icon pack has no fallback name.",
		});
	} else if (!(pack.fallback in icons)) {
		issues.push({
			code: IconPackIssueCode.FallbackNotInPack,
			message: `Fallback "${pack.fallback}" is not a glyph the pack defines.`,
			iconName: pack.fallback,
		});
	}

	return issues;
}

export function isValidIconPack(pack: IconPackDef): boolean {
	return validateIconPack(pack).length === 0;
}
