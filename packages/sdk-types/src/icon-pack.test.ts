import { describe, expect, it } from "vitest";
import {
	CANONICAL_ICON_NAMES,
	CANONICAL_ICON_REGISTRY_VERSION,
	ICON_PACK_STYLES,
	ICON_PACK_TYPE_URL,
	type IconPackDef,
	IconPackIssueCode,
	IconPackStyle,
	isAppScopedIconName,
	isCanonicalIconName,
	isIconPackStyle,
	isReferenceableIconName,
	isValidIconPack,
	resolveIconSvg,
	validateIconPack,
} from "./icon-pack";

const SVG = '<svg viewBox="0 0 24 24"></svg>';

function pack(over: Partial<IconPackDef> = {}): IconPackDef {
	return {
		name: "Phosphor",
		version: "0.300.0",
		license: "MIT",
		metadata: { style: IconPackStyle.Line, weight: "regular" },
		icons: {
			save: { svg: SVG },
			"entity.note": { svg: SVG },
			questionmark: { svg: SVG },
		},
		fallback: "questionmark",
		...over,
	};
}

describe("constants + frozen tables", () => {
	it("pins the type url + registry version", () => {
		expect(ICON_PACK_TYPE_URL).toBe("brainstorm/IconPack/v1");
		expect(CANONICAL_ICON_REGISTRY_VERSION).toBe(1);
	});

	it("freezes the style table (↔ enum) and the canonical-name set", () => {
		expect(Object.isFrozen(ICON_PACK_STYLES)).toBe(true);
		expect([...ICON_PACK_STYLES].sort()).toEqual([...Object.values(IconPackStyle)].sort());
		expect(Object.isFrozen(CANONICAL_ICON_NAMES)).toBe(true);
		// The doc-named exemplars + the fallback name must be present.
		for (const n of ["save", "settings", "trash", "questionmark"]) {
			expect(CANONICAL_ICON_NAMES).toContain(n);
		}
	});
});

describe("isIconPackStyle", () => {
	it("accepts members, rejects junk + non-strings", () => {
		expect(isIconPackStyle(IconPackStyle.Duotone)).toBe(true);
		expect(isIconPackStyle("neon")).toBe(false);
		expect(isIconPackStyle(5)).toBe(false);
	});
});

describe("icon-name namespaces", () => {
	it("canonical: registry members + open entity.* / vocab.color.* sub-namespaces", () => {
		expect(isCanonicalIconName("save")).toBe(true);
		expect(isCanonicalIconName("entity.note")).toBe(true);
		expect(isCanonicalIconName("entity.custom-type")).toBe(true);
		expect(isCanonicalIconName("vocab.color.red")).toBe(true);
		expect(isCanonicalIconName("vocab.color.hot-pink")).toBe(true);
		// Not canonical: invented bare name, malformed sub-namespace, non-string.
		expect(isCanonicalIconName("kanban-column")).toBe(false);
		expect(isCanonicalIconName("entity.")).toBe(false);
		expect(isCanonicalIconName("vocab.color.")).toBe(false);
		expect(isCanonicalIconName("")).toBe(false);
		expect(isCanonicalIconName(42)).toBe(false);
		// An app-scoped name is NOT canonical.
		expect(isCanonicalIconName("io.example.tasks/icon.kanban")).toBe(false);
	});

	it("app-scoped: <app-id>/<icon-name> only", () => {
		expect(isAppScopedIconName("io.example.tasks/icon.kanban-column")).toBe(true);
		expect(isAppScopedIconName("io.x/foo")).toBe(true);
		expect(isAppScopedIconName("save")).toBe(false); // bare → not app-scoped
		expect(isAppScopedIconName("io.x/")).toBe(false);
		expect(isAppScopedIconName("/foo")).toBe(false);
		expect(isAppScopedIconName("nodots/foo")).toBe(false); // id needs a dot/dash segment
		expect(isAppScopedIconName(null)).toBe(false);
	});

	it("referenceable = canonical OR app-scoped (an invented bare name is neither)", () => {
		expect(isReferenceableIconName("settings")).toBe(true);
		expect(isReferenceableIconName("io.example.tasks/icon.kanban")).toBe(true);
		expect(isReferenceableIconName("totallymadeup")).toBe(false);
	});
});

describe("resolveIconSvg", () => {
	it("returns the direct glyph when present", () => {
		expect(resolveIconSvg(pack(), "save")).toBe(SVG);
	});

	it("falls back to the pack's fallback glyph when the name is missing", () => {
		expect(resolveIconSvg(pack(), "settings")).toBe(SVG); // → questionmark
	});

	it("returns null (never throws) when neither the name nor a usable fallback resolves", () => {
		expect(resolveIconSvg(null, "save")).toBeNull();
		expect(resolveIconSvg(undefined, "save")).toBeNull();
		expect(resolveIconSvg(pack({ icons: {}, fallback: "questionmark" }), "save")).toBeNull();
		expect(resolveIconSvg(pack({ fallback: "missing" }), "settings")).toBeNull();
		// An empty-string svg is treated as missing → fallback path.
		const p = pack({ icons: { save: { svg: "" }, questionmark: { svg: SVG } } });
		expect(resolveIconSvg(p, "save")).toBe(SVG);
	});
});

describe("validateIconPack", () => {
	const codes = (p: IconPackDef) => validateIconPack(p).map((i) => i.code);

	it("a well-formed pack is valid", () => {
		expect(validateIconPack(pack())).toEqual([]);
		expect(isValidIconPack(pack())).toBe(true);
	});

	it("flags blank name / version / license + invalid style", () => {
		const c = codes(
			pack({
				name: " ",
				version: "",
				license: "",
				metadata: { style: "neon" as IconPackStyle },
			}),
		);
		expect(c).toEqual(
			expect.arrayContaining([
				IconPackIssueCode.EmptyName,
				IconPackIssueCode.EmptyVersion,
				IconPackIssueCode.EmptyLicense,
				IconPackIssueCode.InvalidStyle,
			]),
		);
	});

	it("flags an empty icons map and short-circuits glyph checks", () => {
		const c = codes(pack({ icons: {} }));
		expect(c).toContain(IconPackIssueCode.NoIcons);
		expect(c).not.toContain(IconPackIssueCode.EmptyGlyph);
	});

	it("flags an invented-bare-canonical key and an empty glyph", () => {
		const issues = validateIconPack(
			pack({
				icons: { "made-up": { svg: SVG }, save: { svg: "  " }, questionmark: { svg: SVG } },
			}),
		);
		const names = issues
			.filter((i) => i.code === IconPackIssueCode.InvalidIconName)
			.map((i) => i.iconName);
		expect(names).toContain("made-up");
		expect(issues.some((i) => i.code === IconPackIssueCode.EmptyGlyph && i.iconName === "save")).toBe(
			true,
		);
	});

	it("flags an empty fallback and a fallback that isn't a defined glyph", () => {
		expect(codes(pack({ fallback: "" }))).toContain(IconPackIssueCode.EmptyFallback);
		const c = codes(pack({ fallback: "nope" }));
		expect(c).toContain(IconPackIssueCode.FallbackNotInPack);
	});
});
