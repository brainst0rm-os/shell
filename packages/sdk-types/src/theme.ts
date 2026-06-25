/**
 * `brainstorm/Theme/v1` — the composite that references one TokenSet,
 * one IconPack, one Typography (and optionally one StylePack), per
 * docs/apps/40-theme-store.md §What's distributed. The theme-editor
 * (9.9) composes these; the shell resolves the references and applies
 * the union to its surfaces.
 *
 * Each component is referenced **by id**: either an installed component
 * entity (`ThemeRefKind.Entity` + `entityId`) or a built-in shipped
 * with the shell (`ThemeRefKind.Builtin` + a sentinel name like
 * `shell/default-light`, `phosphor`, `system`). A composite that
 * references an uninstalled component triggers the dependency-resolution
 * prompt (doc 40 §Install protocol; implemented in 9.9.5).
 *
 * `stylePack` is optional: the `brainstorm/StylePack/v1` contract (raw-CSS
 * fourth component, with its bundle validator + the `data-bs-*` hook
 * surface) landed in 9.9.4 (`style-pack.ts`). A composite references a
 * style pack the same way as the other three components.
 *
 * Dependency-free **contract freeze** (Stage 9.9.1) — shape + enums +
 * shipped default + validators + a defensive ref resolver. Validation is
 * **structural ref validity only**; it does NOT recurse into the
 * referenced components (that's the install/dependency step in 9.9.5).
 * Near-leaf (only `enum-guard` + `token-set` leaves imported),
 * barrel-re-exported with no cycle.
 */

import { enumGuard } from "./enum-guard";
import { TokenSetAppearance, isTokenSetAppearance } from "./token-set";

export const THEME_TYPE_URL = "brainstorm/Theme/v1";

/** Local alias for an entity id. Kept as a plain `string` here (rather
 *  than importing the `index.ts` `EntityId` alias) so this contract leaf
 *  stays dependency-free and introduces no barrel cycle. */
type ThemeEntityId = string;

/** How a Theme references one of its components. */
export enum ThemeRefKind {
	/** An installed component entity (TokenSet / IconPack / Typography). */
	Entity = "entity",
	/** A component shipped with the shell, addressed by a stable sentinel
	 *  name (`shell/default-light`, `phosphor`, `system`). */
	Builtin = "builtin",
}

export const THEME_REF_KINDS = Object.freeze([
	ThemeRefKind.Entity,
	ThemeRefKind.Builtin,
]) as readonly ThemeRefKind[];

export type ThemeComponentRef =
	| { kind: ThemeRefKind.Entity; entityId: ThemeEntityId }
	| { kind: ThemeRefKind.Builtin; name: string };

/**
 * The Theme entity payload (`properties` of a `brainstorm/Theme/v1`
 * object). `appearance` reuses the TokenSet appearance vocabulary so the
 * whole theme has one appearance vocabulary.
 */
export type ThemeDef = {
	name: string;
	appearance: TokenSetAppearance;
	tokenSet: ThemeComponentRef;
	iconPack: ThemeComponentRef;
	typography: ThemeComponentRef;
	/** Optional fourth component — `brainstorm/StylePack/v1` (9.9.4). */
	stylePack?: ThemeComponentRef;
};

/** Stable built-in component sentinels (doc 40 §Install protocol). */
export const BUILTIN_TOKEN_SET = "shell/default-light";
export const BUILTIN_ICON_PACK = "phosphor";
export const BUILTIN_TYPOGRAPHY = "system";

function builtin(name: string): ThemeComponentRef {
	return { kind: ThemeRefKind.Builtin, name };
}

/**
 * The shipped default composite — every reference points at a built-in,
 * so it resolves with nothing installed. The editor seeds a new theme
 * from this.
 */
export const DEFAULT_THEME_COMPOSITE: ThemeDef = Object.freeze({
	name: "Default",
	appearance: TokenSetAppearance.Light,
	tokenSet: Object.freeze(builtin(BUILTIN_TOKEN_SET)) as ThemeComponentRef,
	iconPack: Object.freeze(builtin(BUILTIN_ICON_PACK)) as ThemeComponentRef,
	typography: Object.freeze(builtin(BUILTIN_TYPOGRAPHY)) as ThemeComponentRef,
}) as ThemeDef;

export const isThemeRefKind = enumGuard(THEME_REF_KINDS);

/** `true` iff `ref` is a structurally well-formed component reference
 *  (a known kind with its required, non-blank id/name field). */
export function isValidThemeRef(ref: unknown): ref is ThemeComponentRef {
	if (!ref || typeof ref !== "object") return false;
	const r = ref as { kind?: unknown; entityId?: unknown; name?: unknown };
	if (r.kind === ThemeRefKind.Entity) {
		return typeof r.entityId === "string" && r.entityId.trim().length > 0;
	}
	if (r.kind === ThemeRefKind.Builtin) {
		return typeof r.name === "string" && r.name.trim().length > 0;
	}
	return false;
}

/**
 * The component reference to actually use — `ref` when it is structurally
 * valid, else a safe `Builtin` fallback so a malformed/partial entity
 * never yields a missing component. Never throws.
 */
export function resolveThemeRef(
	ref: ThemeComponentRef | null | undefined,
	fallbackName: string,
): ThemeComponentRef {
	return isValidThemeRef(ref) ? ref : builtin(fallbackName);
}

/** Stable codes for Theme validation failures. */
export enum ThemeIssueCode {
	EmptyName = "empty-name",
	InvalidAppearance = "invalid-appearance",
	InvalidTokenSetRef = "invalid-token-set-ref",
	InvalidIconPackRef = "invalid-icon-pack-ref",
	InvalidTypographyRef = "invalid-typography-ref",
	InvalidStylePackRef = "invalid-style-pack-ref",
}

export type ThemeIssue = { code: ThemeIssueCode; message: string };

/**
 * Validate a `ThemeDef` — non-blank name, valid appearance, and a
 * structurally valid reference for each required component. The optional
 * `stylePack` is validated only when present. Does NOT recurse into the
 * referenced components.
 */
export function validateTheme(def: ThemeDef): ThemeIssue[] {
	const issues: ThemeIssue[] = [];
	if (typeof def.name !== "string" || def.name.trim().length === 0) {
		issues.push({ code: ThemeIssueCode.EmptyName, message: "Theme name is empty." });
	}
	if (!isTokenSetAppearance(def.appearance)) {
		issues.push({
			code: ThemeIssueCode.InvalidAppearance,
			message: `Unknown theme appearance "${String(def.appearance)}".`,
		});
	}
	if (!isValidThemeRef(def.tokenSet)) {
		issues.push({
			code: ThemeIssueCode.InvalidTokenSetRef,
			message: "Theme has an invalid token-set reference.",
		});
	}
	if (!isValidThemeRef(def.iconPack)) {
		issues.push({
			code: ThemeIssueCode.InvalidIconPackRef,
			message: "Theme has an invalid icon-pack reference.",
		});
	}
	if (!isValidThemeRef(def.typography)) {
		issues.push({
			code: ThemeIssueCode.InvalidTypographyRef,
			message: "Theme has an invalid typography reference.",
		});
	}
	if (def.stylePack !== undefined && !isValidThemeRef(def.stylePack)) {
		issues.push({
			code: ThemeIssueCode.InvalidStylePackRef,
			message: "Theme has an invalid style-pack reference.",
		});
	}
	return issues;
}

export function isValidTheme(def: ThemeDef): boolean {
	return validateTheme(def).length === 0;
}
