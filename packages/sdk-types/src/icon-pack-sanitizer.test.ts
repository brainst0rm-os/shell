import { describe, expect, it } from "vitest";
import {
	type IconPackDef,
	IconPackIssueCode,
	IconPackStyle,
	resolveIconSvg,
	validateIconPack,
} from "./icon-pack";
import {
	IconPackSvgSanitizeCode,
	findIconPackSvgIssues,
	isIconPackSvgSafe,
	sanitizeIconPackSvg,
} from "./icon-pack-sanitizer";

const BENIGN = '<svg viewBox="0 0 256 256"><path d="M8 8 L248 248" fill="currentColor"/></svg>';

function codes(svg: string): IconPackSvgSanitizeCode[] {
	return findIconPackSvgIssues(svg).map((i) => i.code);
}

describe("findIconPackSvgIssues — clean input", () => {
	it("passes a benign path glyph", () => {
		expect(findIconPackSvgIssues(BENIGN)).toEqual([]);
		expect(isIconPackSvgSafe(BENIGN)).toBe(true);
	});

	it("allows a same-document fragment <use>", () => {
		const svg = '<svg><defs><path id="a" d="M0 0"/></defs><use href="#a"/></svg>';
		expect(findIconPackSvgIssues(svg)).toEqual([]);
	});

	it("empty / non-string input is clean", () => {
		expect(findIconPackSvgIssues("")).toEqual([]);
		expect(findIconPackSvgIssues(undefined as unknown as string)).toEqual([]);
	});
});

describe("findIconPackSvgIssues — active-content vectors", () => {
	it("flags <script>", () => {
		expect(codes("<svg><script>alert(1)</script></svg>")).toContain(
			IconPackSvgSanitizeCode.ScriptElement,
		);
	});

	it("flags <foreignObject>", () => {
		expect(codes("<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>")).toContain(
			IconPackSvgSanitizeCode.ForeignObject,
		);
	});

	it("flags SMIL animation elements (onbegin)", () => {
		expect(codes('<svg><set onbegin="alert(1)"/></svg>')).toContain(
			IconPackSvgSanitizeCode.AnimationElement,
		);
		expect(codes('<svg><animate onbegin="alert(1)"/></svg>')).toContain(
			IconPackSvgSanitizeCode.AnimationElement,
		);
		expect(codes("<svg><animateTransform/></svg>")).toContain(
			IconPackSvgSanitizeCode.AnimationElement,
		);
		expect(codes("<svg><animateMotion/></svg>")).toContain(IconPackSvgSanitizeCode.AnimationElement);
	});

	it("flags external / javascript: <use>", () => {
		expect(codes('<svg><use href="javascript:alert(1)"/></svg>')).toContain(
			IconPackSvgSanitizeCode.ExternalUse,
		);
		expect(codes('<svg><use xlink:href="https://evil.test/x.svg#a"/></svg>')).toContain(
			IconPackSvgSanitizeCode.ExternalUse,
		);
	});

	it("flags on* event-handler attributes", () => {
		expect(codes('<svg onload="alert(1)"><path d="M0 0"/></svg>')).toContain(
			IconPackSvgSanitizeCode.EventHandler,
		);
		expect(codes('<svg><circle onclick="x()" r="4"/></svg>')).toContain(
			IconPackSvgSanitizeCode.EventHandler,
		);
	});

	it("flags javascript:/data:text/html URLs in href/src", () => {
		expect(codes('<svg><a href="javascript:alert(1)"><path/></a></svg>')).toContain(
			IconPackSvgSanitizeCode.ScriptUrl,
		);
		expect(codes('<svg><image href="data:text/html,<script>alert(1)</script>"/></svg>')).toContain(
			IconPackSvgSanitizeCode.ScriptUrl,
		);
	});

	it("sees through HTML-entity obfuscation", () => {
		expect(codes("<svg>&lt;script&gt;alert(1)&lt;/script&gt;</svg>")).toContain(
			IconPackSvgSanitizeCode.ScriptElement,
		);
		expect(codes('<svg><a href="&#106;avascript:alert(1)"/></svg>')).toContain(
			IconPackSvgSanitizeCode.ScriptUrl,
		);
	});
});

describe("sanitizeIconPackSvg — strips, keeps the safe glyph", () => {
	it("returns a benign glyph unchanged", () => {
		expect(sanitizeIconPackSvg(BENIGN)).toBe(BENIGN);
	});

	it("strips every vector while keeping the safe markup", () => {
		const dirty =
			'<svg onload="alert(1)">' +
			"<script>alert(1)</script>" +
			"<foreignObject><b onclick=x()>hi</b></foreignObject>" +
			'<set onbegin="alert(2)"/>' +
			'<use href="javascript:alert(3)"/>' +
			'<a href="javascript:alert(4)"><path d="M8 8"/></a>' +
			"</svg>";
		const clean = sanitizeIconPackSvg(dirty);
		expect(clean).not.toMatch(/<script/i);
		expect(clean).not.toMatch(/<foreignObject/i);
		expect(clean).not.toMatch(/<set/i);
		expect(clean).not.toMatch(/<use/i);
		expect(clean).not.toMatch(/onload|onclick|onbegin/i);
		expect(clean).not.toMatch(/javascript:/i);
		expect(clean).toContain('<path d="M8 8"/>');
		expect(isIconPackSvgSafe(clean)).toBe(true);
	});
});

function packWith(svg: string): IconPackDef {
	return {
		name: "Test pack",
		version: "1.0.0",
		license: "MIT",
		metadata: { style: IconPackStyle.Line },
		icons: { save: { svg } },
		fallback: "save",
	};
}

describe("validateIconPack — gate blocks unsafe glyphs", () => {
	it("rejects a pack whose glyph carries a <script>", () => {
		const issues = validateIconPack(packWith("<svg><script>alert(1)</script></svg>"));
		expect(issues.map((i) => i.code)).toContain(IconPackIssueCode.UnsafeGlyph);
	});

	it("rejects on* / foreignObject / external <use>", () => {
		expect(
			validateIconPack(packWith('<svg onload="alert(1)"><path/></svg>')).map((i) => i.code),
		).toContain(IconPackIssueCode.UnsafeGlyph);
		expect(
			validateIconPack(packWith("<svg><foreignObject>x</foreignObject></svg>")).map((i) => i.code),
		).toContain(IconPackIssueCode.UnsafeGlyph);
		expect(
			validateIconPack(packWith('<svg><use href="javascript:alert(1)"/></svg>')).map((i) => i.code),
		).toContain(IconPackIssueCode.UnsafeGlyph);
	});

	it("accepts a benign glyph", () => {
		expect(validateIconPack(packWith(BENIGN))).toEqual([]);
	});
});

describe("resolveIconSvg — sink chokepoint sanitizes (defense-in-depth)", () => {
	it("returns sanitized markup even for an unvalidated pack", () => {
		const resolved = resolveIconSvg(
			packWith('<svg onload="alert(1)"><script>x</script><path d="M0 0"/></svg>'),
			"save",
		);
		expect(resolved).not.toBeNull();
		expect(resolved).not.toMatch(/<script|onload/i);
		expect(resolved).toContain('<path d="M0 0"/>');
	});

	it("sanitizes the fallback glyph path too", () => {
		const pack: IconPackDef = {
			...packWith("<svg><path/></svg>"),
			icons: { save: { svg: '<svg><script>alert(1)</script><path d="M1 1"/></svg>' } },
			fallback: "save",
		};
		const resolved = resolveIconSvg(pack, "not-present");
		expect(resolved).not.toMatch(/<script/i);
		expect(resolved).toContain('<path d="M1 1"/>');
	});
});
