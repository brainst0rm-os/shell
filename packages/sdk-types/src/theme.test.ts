import { describe, expect, it } from "vitest";
import {
	BUILTIN_ICON_PACK,
	BUILTIN_TOKEN_SET,
	BUILTIN_TYPOGRAPHY,
	DEFAULT_THEME_COMPOSITE,
	THEME_REF_KINDS,
	THEME_TYPE_URL,
	type ThemeComponentRef,
	type ThemeDef,
	ThemeIssueCode,
	ThemeRefKind,
	isThemeRefKind,
	isValidTheme,
	isValidThemeRef,
	resolveThemeRef,
	validateTheme,
} from "./theme";
import { TokenSetAppearance } from "./token-set";

const entityRef: ThemeComponentRef = { kind: ThemeRefKind.Entity, entityId: "ent-1" };

function theme(over: Partial<ThemeDef> = {}): ThemeDef {
	return {
		name: "Test theme",
		appearance: TokenSetAppearance.Light,
		tokenSet: { kind: ThemeRefKind.Builtin, name: BUILTIN_TOKEN_SET },
		iconPack: { kind: ThemeRefKind.Builtin, name: BUILTIN_ICON_PACK },
		typography: { kind: ThemeRefKind.Builtin, name: BUILTIN_TYPOGRAPHY },
		...over,
	};
}

describe("constants + frozen default", () => {
	it("pins the canonical type url", () => {
		expect(THEME_TYPE_URL).toBe("brainstorm/Theme/v1");
	});

	it("freezes the ref-kind table and it mirrors the enum", () => {
		expect(Object.isFrozen(THEME_REF_KINDS)).toBe(true);
		expect([...THEME_REF_KINDS].sort()).toEqual([...Object.values(ThemeRefKind)].sort());
	});

	it("ships a valid, frozen default composite pointing at built-ins", () => {
		expect(Object.isFrozen(DEFAULT_THEME_COMPOSITE)).toBe(true);
		expect(isValidTheme(DEFAULT_THEME_COMPOSITE)).toBe(true);
		expect(DEFAULT_THEME_COMPOSITE.tokenSet).toEqual({
			kind: ThemeRefKind.Builtin,
			name: BUILTIN_TOKEN_SET,
		});
		expect(DEFAULT_THEME_COMPOSITE.stylePack).toBeUndefined();
	});
});

describe("isThemeRefKind", () => {
	it("accepts members, rejects everything else", () => {
		expect(isThemeRefKind("entity")).toBe(true);
		expect(isThemeRefKind("builtin")).toBe(true);
		expect(isThemeRefKind("file")).toBe(false);
		expect(isThemeRefKind(null)).toBe(false);
	});
});

describe("isValidThemeRef", () => {
	it("accepts a well-formed entity ref", () => {
		expect(isValidThemeRef(entityRef)).toBe(true);
	});

	it("accepts a well-formed builtin ref", () => {
		expect(isValidThemeRef({ kind: ThemeRefKind.Builtin, name: "x" })).toBe(true);
	});

	it("rejects blank ids/names and unknown kinds", () => {
		expect(isValidThemeRef({ kind: ThemeRefKind.Entity, entityId: "  " })).toBe(false);
		expect(isValidThemeRef({ kind: ThemeRefKind.Builtin, name: "" })).toBe(false);
		expect(isValidThemeRef({ kind: "bogus", name: "x" })).toBe(false);
		expect(isValidThemeRef(null)).toBe(false);
		expect(isValidThemeRef("nope")).toBe(false);
	});
});

describe("resolveThemeRef", () => {
	it("returns the ref when valid", () => {
		expect(resolveThemeRef(entityRef, "fb")).toBe(entityRef);
	});

	it("falls back to a builtin when malformed; never throws", () => {
		expect(resolveThemeRef(null, "fb")).toEqual({ kind: ThemeRefKind.Builtin, name: "fb" });
		expect(
			resolveThemeRef({ kind: ThemeRefKind.Entity } as unknown as ThemeComponentRef, "fb"),
		).toEqual({
			kind: ThemeRefKind.Builtin,
			name: "fb",
		});
	});
});

describe("validateTheme", () => {
	it("passes a well-formed composite", () => {
		expect(validateTheme(theme())).toEqual([]);
	});

	it("flags each component class of bad reference", () => {
		const issues = validateTheme(
			theme({
				name: "  ",
				appearance: "x" as TokenSetAppearance,
				tokenSet: { kind: ThemeRefKind.Entity, entityId: "" },
				iconPack: null as unknown as ThemeComponentRef,
				typography: { kind: "bad" } as unknown as ThemeComponentRef,
			}),
		);
		const codes = issues.map((i) => i.code);
		expect(codes).toContain(ThemeIssueCode.EmptyName);
		expect(codes).toContain(ThemeIssueCode.InvalidAppearance);
		expect(codes).toContain(ThemeIssueCode.InvalidTokenSetRef);
		expect(codes).toContain(ThemeIssueCode.InvalidIconPackRef);
		expect(codes).toContain(ThemeIssueCode.InvalidTypographyRef);
	});

	it("tolerates an absent stylePack but flags an invalid one", () => {
		expect(validateTheme(theme())).toEqual([]);
		const issues = validateTheme(theme({ stylePack: { kind: ThemeRefKind.Entity, entityId: "" } }));
		expect(issues.map((i) => i.code)).toContain(ThemeIssueCode.InvalidStylePackRef);
	});

	it("does not recurse into referenced components (structural only)", () => {
		expect(validateTheme(theme({ tokenSet: entityRef }))).toEqual([]);
	});
});
