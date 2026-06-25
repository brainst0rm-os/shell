/**
 * `brainstorm/Typography/v1` — a theme's font choice (docs/shell/13-
 * frontend-stack.md §Typography). One of the three composable theme
 * pieces alongside TokenSet + IconPack (a `brainstorm/Theme/v1` points
 * at all three); the theme-editor (9.9) edits these and the app-preload
 * theme injection consumes the resolved stacks.
 *
 * Four font roles — `ui` / `body` / `code` / `display` — each a CSS
 * font-family **stack** string. Brainstorm bundles **no proprietary
 * font binaries in v1** (doc decision): the shipped default is a pure
 * system stack; named faces (Inter, JetBrains Mono…) only render if the
 * OS/user already has them, the stack degrading to the system family.
 *
 * Dependency-free **contract freeze** (Stage 8.7) — the shape + enums +
 * the shipped `SYSTEM_TYPOGRAPHY` default + validators + a defensive
 * per-role resolver. Near-leaf (only the shared `enum-guard` leaf is
 * imported), barrel-re-exported with no cycle. No blocking OQ.
 */

import { enumGuard } from "./enum-guard";

export const TYPOGRAPHY_TYPE_URL = "brainstorm/Typography/v1";

/** The four typographic roles a theme assigns a font stack to. */
export enum FontRole {
	/** Chrome / controls / dense UI. */
	Ui = "ui",
	/** Long-form reading content. */
	Body = "body",
	/** Monospace — code, IDs, diffs. */
	Code = "code",
	/** Large headings / hero display. */
	Display = "display",
}

/** Density scale — drives the spacing/size step the renderer applies on
 *  top of the size tokens (doc 13 §Typography: "default | compact |
 *  comfortable"). */
export enum TypographyScale {
	Default = "default",
	Compact = "compact",
	Comfortable = "comfortable",
}

export const FONT_ROLES = Object.freeze([
	FontRole.Ui,
	FontRole.Body,
	FontRole.Code,
	FontRole.Display,
]) as readonly FontRole[];

export const TYPOGRAPHY_SCALES = Object.freeze([
	TypographyScale.Default,
	TypographyScale.Compact,
	TypographyScale.Comfortable,
]) as readonly TypographyScale[];

/** A CSS `font-family` value. `stack` is the full comma-separated list
 *  (named faces first, ending in a generic family). */
export type FontStack = { stack: string };

/**
 * The Typography entity payload (`properties` of a
 * `brainstorm/Typography/v1` object). A well-formed entity assigns
 * every `FontRole` (validator enforces); the resolver still degrades
 * defensively so loosely-typed vault data never yields an empty
 * font-family.
 */
export type TypographyDef = {
	name: string;
	fonts: Record<FontRole, FontStack>;
	scale: TypographyScale;
};

/**
 * The shipped default — a pure **system** stack (no bundled binaries,
 * per the doc decision). Every other Typography composes/overrides
 * against this; `resolveFontStack` falls back here per role so a
 * missing/blank role never produces an empty `font-family`.
 */
export const SYSTEM_TYPOGRAPHY: TypographyDef = Object.freeze({
	name: "System default",
	fonts: Object.freeze({
		[FontRole.Ui]: { stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
		[FontRole.Body]: { stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
		[FontRole.Code]: { stack: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
		[FontRole.Display]: { stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
	}) as Record<FontRole, FontStack>,
	scale: TypographyScale.Default,
}) as TypographyDef;

export const isFontRole = enumGuard(FONT_ROLES);
export const isTypographyScale = enumGuard(TYPOGRAPHY_SCALES);

/**
 * The CSS `font-family` to actually apply for `role` — the entity's
 * stack when present and non-blank, else the `SYSTEM_TYPOGRAPHY` stack
 * for that role. Never returns empty: every role always resolves to a
 * usable family (the "always render something" principle, applied to
 * fonts). Tolerates loosely-typed / partial vault data.
 */
export function resolveFontStack(typo: TypographyDef | null | undefined, role: FontRole): string {
	const fallback = SYSTEM_TYPOGRAPHY.fonts[role].stack;
	const raw = typo?.fonts?.[role]?.stack;
	if (typeof raw !== "string") return fallback;
	const trimmed = raw.trim();
	return trimmed.length > 0 ? trimmed : fallback;
}

/** Stable codes for Typography validation failures (enum, not bare
 *  literals, per the no-string-discriminator convention). */
export enum TypographyIssueCode {
	EmptyName = "empty-name",
	InvalidScale = "invalid-scale",
	MissingFonts = "missing-fonts",
	MissingRole = "missing-role",
	EmptyStack = "empty-stack",
}

export type TypographyIssue = { code: TypographyIssueCode; message: string; role?: FontRole };

/**
 * Validate a `TypographyDef`. Returns every issue (`[]` ⇒ valid) so the
 * theme editor can surface them at once. A well-formed entity has a
 * non-blank name, a valid scale, and a non-blank stack for **every**
 * `FontRole`.
 */
export function validateTypography(def: TypographyDef): TypographyIssue[] {
	const issues: TypographyIssue[] = [];
	if (typeof def.name !== "string" || def.name.trim().length === 0) {
		issues.push({ code: TypographyIssueCode.EmptyName, message: "Typography name is empty." });
	}
	if (!isTypographyScale(def.scale)) {
		issues.push({
			code: TypographyIssueCode.InvalidScale,
			message: `Unknown typography scale "${String(def.scale)}".`,
		});
	}
	if (!def.fonts || typeof def.fonts !== "object") {
		issues.push({ code: TypographyIssueCode.MissingFonts, message: "Typography has no fonts map." });
		return issues;
	}
	for (const role of FONT_ROLES) {
		const entry = def.fonts[role];
		if (!entry || typeof entry !== "object") {
			issues.push({
				code: TypographyIssueCode.MissingRole,
				message: `Typography is missing the "${role}" font role.`,
				role,
			});
			continue;
		}
		if (typeof entry.stack !== "string" || entry.stack.trim().length === 0) {
			issues.push({
				code: TypographyIssueCode.EmptyStack,
				message: `Font role "${role}" has an empty stack.`,
				role,
			});
		}
	}
	return issues;
}

export function isValidTypography(def: TypographyDef): boolean {
	return validateTypography(def).length === 0;
}
