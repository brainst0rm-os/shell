import { describe, expect, it } from "vitest";
import {
	FONT_ROLES,
	FontRole,
	SYSTEM_TYPOGRAPHY,
	TYPOGRAPHY_SCALES,
	TYPOGRAPHY_TYPE_URL,
	type TypographyDef,
	TypographyIssueCode,
	TypographyScale,
	isFontRole,
	isTypographyScale,
	isValidTypography,
	resolveFontStack,
	validateTypography,
} from "./typography";

function typo(over: Partial<TypographyDef> = {}): TypographyDef {
	return {
		name: "Test",
		scale: TypographyScale.Default,
		fonts: {
			[FontRole.Ui]: { stack: "Inter, sans-serif" },
			[FontRole.Body]: { stack: "Inter, sans-serif" },
			[FontRole.Code]: { stack: "JetBrains Mono, monospace" },
			[FontRole.Display]: { stack: "Inter, sans-serif" },
		},
		...over,
	};
}

describe("constants + frozen tables", () => {
	it("pins the canonical type url", () => {
		expect(TYPOGRAPHY_TYPE_URL).toBe("brainstorm/Typography/v1");
	});

	it("freezes the tables and they mirror the enums", () => {
		expect(Object.isFrozen(FONT_ROLES)).toBe(true);
		expect(Object.isFrozen(TYPOGRAPHY_SCALES)).toBe(true);
		expect([...FONT_ROLES].sort()).toEqual([...Object.values(FontRole)].sort());
		expect([...TYPOGRAPHY_SCALES].sort()).toEqual([...Object.values(TypographyScale)].sort());
	});

	it("ships a frozen, valid, fully-roled system default with no bundled faces", () => {
		expect(Object.isFrozen(SYSTEM_TYPOGRAPHY)).toBe(true);
		expect(isValidTypography(SYSTEM_TYPOGRAPHY)).toBe(true);
		expect(SYSTEM_TYPOGRAPHY.scale).toBe(TypographyScale.Default);
		for (const role of FONT_ROLES) {
			expect(SYSTEM_TYPOGRAPHY.fonts[role].stack.length).toBeGreaterThan(0);
		}
		// Pure system stacks — no proprietary binaries shipped (doc 13 decision).
		expect(SYSTEM_TYPOGRAPHY.fonts[FontRole.Ui].stack).toContain("system-ui");
		expect(SYSTEM_TYPOGRAPHY.fonts[FontRole.Code].stack).toMatch(/monospace$/);
	});
});

describe("type guards", () => {
	it("accept valid members, reject junk + non-strings", () => {
		expect(isFontRole(FontRole.Code)).toBe(true);
		expect(isFontRole("heading")).toBe(false);
		expect(isFontRole(3)).toBe(false);
		expect(isTypographyScale(TypographyScale.Comfortable)).toBe(true);
		expect(isTypographyScale("huge")).toBe(false);
		expect(isTypographyScale(null)).toBe(false);
	});
});

describe("resolveFontStack", () => {
	it("returns the entity stack when present + non-blank", () => {
		expect(resolveFontStack(typo(), FontRole.Code)).toBe("JetBrains Mono, monospace");
	});

	it("trims surrounding whitespace", () => {
		const t = typo({ fonts: { ...typo().fonts, [FontRole.Body]: { stack: "  Georgia, serif  " } } });
		expect(resolveFontStack(t, FontRole.Body)).toBe("Georgia, serif");
	});

	it("falls back to the system stack per role for missing / blank / non-string / null", () => {
		const sysCode = SYSTEM_TYPOGRAPHY.fonts[FontRole.Code].stack;
		const sysUi = SYSTEM_TYPOGRAPHY.fonts[FontRole.Ui].stack;
		expect(resolveFontStack(null, FontRole.Code)).toBe(sysCode);
		expect(resolveFontStack(undefined, FontRole.Code)).toBe(sysCode);
		expect(resolveFontStack(typo({ fonts: {} as TypographyDef["fonts"] }), FontRole.Ui)).toBe(sysUi);
		const blank = typo({ fonts: { ...typo().fonts, [FontRole.Ui]: { stack: "   " } } });
		expect(resolveFontStack(blank, FontRole.Ui)).toBe(sysUi);
		const bad = typo({
			fonts: { ...typo().fonts, [FontRole.Ui]: { stack: 42 as unknown as string } },
		});
		expect(resolveFontStack(bad, FontRole.Ui)).toBe(sysUi);
	});

	it("never returns an empty family for any role", () => {
		for (const role of FONT_ROLES) {
			expect(resolveFontStack({} as TypographyDef, role).length).toBeGreaterThan(0);
		}
	});
});

describe("validateTypography", () => {
	const codes = (d: TypographyDef) => validateTypography(d).map((i) => i.code);

	it("a well-formed typography is valid", () => {
		expect(validateTypography(typo())).toEqual([]);
		expect(isValidTypography(typo())).toBe(true);
	});

	it("flags an empty / blank name", () => {
		expect(codes(typo({ name: "" }))).toContain(TypographyIssueCode.EmptyName);
		expect(codes(typo({ name: "   " }))).toContain(TypographyIssueCode.EmptyName);
	});

	it("flags an invalid scale", () => {
		expect(codes(typo({ scale: "giant" as TypographyScale }))).toContain(
			TypographyIssueCode.InvalidScale,
		);
	});

	it("flags a missing fonts map (and short-circuits role checks)", () => {
		const c = codes(typo({ fonts: undefined as unknown as TypographyDef["fonts"] }));
		expect(c).toContain(TypographyIssueCode.MissingFonts);
		expect(c).not.toContain(TypographyIssueCode.MissingRole);
	});

	it("flags a missing role and an empty stack per role", () => {
		const full = typo().fonts;
		const missing = typo({
			fonts: {
				[FontRole.Ui]: full[FontRole.Ui],
				[FontRole.Body]: full[FontRole.Body],
				[FontRole.Code]: full[FontRole.Code],
			} as TypographyDef["fonts"],
		});
		expect(codes(missing)).toContain(TypographyIssueCode.MissingRole);

		const empty = typo({ fonts: { ...typo().fonts, [FontRole.Code]: { stack: "  " } } });
		const issue = validateTypography(empty).find((i) => i.code === TypographyIssueCode.EmptyStack);
		expect(issue?.role).toBe(FontRole.Code);
	});
});
