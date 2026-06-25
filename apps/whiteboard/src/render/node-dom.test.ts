/**
 * @vitest-environment jsdom
 *
 * Regression guard for the "node bodies render as empty black boxes"
 * bug (Whiteboard, round 2).
 *
 * Root cause: every node-chrome rule in `styles.css` referenced a shell
 * theme token (`--bg-elev` / `--text` / `--accent` / …) with NO
 * fallback. The shell injects those tokens via a sandboxed preload
 * `<style>` element; when that sheet lands a frame late or out of the
 * node layer's scope, `background: var(--bg-elev)` collapses to
 * `transparent` (the node reads as a black box over the dark page) and
 * `color: var(--text)` collapses to the inherited colour (text
 * vanishes). Sticky/Frame survived only because their fill + text are
 * theme-INDEPENDENT literals (`--node-tint` inline / `rgba(0,0,0,.85)`).
 *
 * Two invariants are pinned so this can't silently regress:
 *
 *  1. DOM — every node kind yields a content element carrying real
 *     text/children (no kind produces a bare empty box).
 *  2. CSS — every node-chrome `var(--token)` carries a fallback, so a
 *     node always has a resolved fill + a contrasting text colour even
 *     with the shell token sheet absent.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WhiteboardMessageKey } from "../i18n/t";
import {
	type EmbeddedNode,
	type FrameNode,
	type GroupNode,
	type ImageNode,
	NodeKind,
	ShapeKind,
	type ShapeNode,
	StickyColor,
	type StickyNode,
	TextBlockFormat,
	type TextNode,
	type WhiteboardNode,
} from "../types/node";
import { buildNodeContent } from "./node-dom";

const t = (key: WhiteboardMessageKey, params?: Record<string, string | number>): string =>
	params ? `${key}:${JSON.stringify(params)}` : key;

const base = { id: "n1", x: 0, y: 0, width: 220, height: 120 };
const sticky: StickyNode = {
	...base,
	kind: NodeKind.Sticky,
	text: "plan",
	color: StickyColor.Green,
};
const text: TextNode = {
	...base,
	kind: NodeKind.Text,
	text: "MCP server",
	format: TextBlockFormat.Plain,
};
const quote: TextNode = { ...base, kind: NodeKind.Text, text: "q", format: TextBlockFormat.Quote };
const image: ImageNode = {
	...base,
	kind: NodeKind.Image,
	imageUrl: "data:image/svg+xml,x",
	fit: "contain" as ImageNode["fit"],
	alt: "shot",
};
const imageNoSrc: ImageNode = {
	...base,
	kind: NodeKind.Image,
	imageUrl: "",
	fit: "contain" as ImageNode["fit"],
	alt: "missing",
};
const frame: FrameNode = { ...base, kind: NodeKind.Frame, title: "FOUNDATIONS" };
const group: GroupNode = { ...base, kind: NodeKind.Group, memberIds: ["a", "b"] };
const embedded: EmbeddedNode = {
	...base,
	kind: NodeKind.Embedded,
	entityRef: "brainstorm://entity/abc",
};

describe("buildNodeContent — every kind yields visible content", () => {
	const cases: Array<[string, WhiteboardNode, string]> = [
		["sticky", sticky, "plan"],
		["text", text, "MCP server"],
		["quote", quote, "q"],
		["image", image, ""],
		["image (no src)", imageNoSrc, "missing"],
		["frame", frame, "FOUNDATIONS"],
		["embedded", embedded, "brainstorm://entity/abc"],
	];

	for (const [label, node, expectedText] of cases) {
		it(`${label}: produces a content element with text or a child`, () => {
			const c = buildNodeContent(document, node, t);
			expect(c.children.length).toBeGreaterThan(0);
			const root = c.children[0] as HTMLElement;
			const hasText = (root.textContent ?? "").trim().length > 0;
			const hasChild = root.children.length > 0;
			expect(hasText || hasChild).toBe(true);
			if (expectedText) expect(root.textContent).toContain(expectedText);
			expect(c.aria["aria-label"]).toBeTruthy();
		});
	}

	it("group: no body, but is labelled (it is a pure overlay frame)", () => {
		const c = buildNodeContent(document, group, t);
		expect(c.children.length).toBe(0);
		expect(c.aria["aria-label"]).toContain("whiteboard.node.group.aria");
	});

	it("empty sticky/text fall back to a labelled placeholder, never blank", () => {
		const emptySticky: StickyNode = { ...sticky, text: "" };
		const c = buildNodeContent(document, emptySticky, t);
		const body = c.children[0] as HTMLElement;
		expect(body.classList.contains("whiteboard__node-body--placeholder")).toBe(true);
		expect((body.textContent ?? "").length).toBeGreaterThan(0);
	});

	it("sticky tint is an inline custom property (theme-independent literal)", () => {
		const c = buildNodeContent(document, sticky, t);
		expect(c.vars["--node-tint"]).toMatch(/^#/);
	});

	it("text node carries its format class so the kind selector applies", () => {
		const c = buildNodeContent(document, text, t);
		expect(c.extraClasses).toContain("whiteboard__node--text-plain");
	});
});

describe("Shape geometry (9.17.10)", () => {
	const shape = (s: ShapeKind): ShapeNode => ({
		...base,
		kind: NodeKind.Shape,
		shape: s,
		color: StickyColor.Blue,
	});

	it("rectangle / ellipse render the filled box div", () => {
		for (const s of [ShapeKind.Rectangle, ShapeKind.Ellipse]) {
			const c = buildNodeContent(document, shape(s), t);
			const body = c.children[0] as Element;
			expect(body.tagName.toLowerCase()).toBe("div");
			expect(body.classList.contains("whiteboard__shape-fill")).toBe(true);
			expect(c.extraClasses).toContain(`whiteboard__node--shape-${s}`);
		}
	});

	it("triangle / diamond render a filled SVG polygon", () => {
		for (const s of [ShapeKind.Triangle, ShapeKind.Diamond]) {
			const c = buildNodeContent(document, shape(s), t);
			const svg = c.children[0] as Element;
			expect(svg.tagName.toLowerCase()).toBe("svg");
			expect(svg.classList.contains("whiteboard__shape-svg--fill")).toBe(true);
			expect(svg.querySelector("polygon")).not.toBeNull();
		}
	});

	it("line renders a stroked SVG line (no arrowhead)", () => {
		const c = buildNodeContent(document, shape(ShapeKind.Line), t);
		const svg = c.children[0] as Element;
		expect(svg.classList.contains("whiteboard__shape-svg--stroke")).toBe(true);
		expect(svg.querySelector("line")).not.toBeNull();
		expect(svg.querySelector("polygon")).toBeNull();
	});

	it("arrow renders a stroked line plus an arrowhead polygon", () => {
		const c = buildNodeContent(document, shape(ShapeKind.Arrow), t);
		const svg = c.children[0] as Element;
		expect(svg.classList.contains("whiteboard__shape-svg--stroke")).toBe(true);
		expect(svg.querySelector("line")).not.toBeNull();
		expect(svg.querySelector("polygon.whiteboard__shape-svg-head")).not.toBeNull();
	});

	it("every shape carries a tint var + a labelled role=img", () => {
		for (const s of [ShapeKind.Rectangle, ShapeKind.Triangle, ShapeKind.Line, ShapeKind.Arrow]) {
			const c = buildNodeContent(document, shape(s), t);
			expect(c.vars["--node-tint"]).toMatch(/^#/);
			expect(c.aria.role).toBe("img");
			expect(c.aria["aria-label"]).toBeTruthy();
		}
	});
});

describe("Ink geometry (9.17.9)", () => {
	const ink: WhiteboardNode = {
		...base,
		kind: NodeKind.Ink,
		points: [
			{ x: 0, y: 0 },
			{ x: 50, y: 80 },
			{ x: 100, y: 20 },
		],
		color: StickyColor.Gray,
	};

	it("renders a stroked SVG polyline carrying every point", () => {
		const c = buildNodeContent(document, ink, t);
		const svg = c.children[0] as Element;
		expect(svg.tagName.toLowerCase()).toBe("svg");
		expect(svg.classList.contains("whiteboard__ink-svg")).toBe(true);
		const poly = svg.querySelector("polyline");
		expect(poly).not.toBeNull();
		// 3 points → 3 "x,y" tokens in the points attribute.
		expect((poly?.getAttribute("points") ?? "").trim().split(/\s+/).length).toBe(3);
		expect(c.vars["--node-tint"]).toMatch(/^#/);
		expect(c.aria.role).toBe("img");
	});
});

describe("text style vars (9.17.12) — bold / italic", () => {
	it("emits the weight var only when bold is set", () => {
		const plain = buildNodeContent(document, sticky, t);
		expect(plain.vars["--node-font-weight"]).toBeUndefined();
		const bold = buildNodeContent(document, { ...sticky, bold: true }, t);
		expect(bold.vars["--node-font-weight"]).toBe("600");
	});

	it("emits the style var only when italic is set", () => {
		const plain = buildNodeContent(document, text, t);
		expect(plain.vars["--node-font-style"]).toBeUndefined();
		const italic = buildNodeContent(document, { ...text, italic: true }, t);
		expect(italic.vars["--node-font-style"]).toBe("italic");
	});

	it("a text node carries both vars when bold + italic", () => {
		const c = buildNodeContent(document, { ...text, bold: true, italic: true }, t);
		expect(c.vars["--node-font-weight"]).toBe("600");
		expect(c.vars["--node-font-style"]).toBe("italic");
	});
});

describe("rich runs (9.17.12 rest)", () => {
	it("renders rich runs as styled spans on sticky and text bodies", () => {
		const rich = [{ text: "plain " }, { text: "loud", bold: true }];
		for (const node of [
			{ ...sticky, rich },
			{ ...text, rich },
		]) {
			const c = buildNodeContent(document, node as WhiteboardNode, t);
			const body = c.children[0] as HTMLElement;
			expect(body.textContent).toBe("plain loud");
			const span = body.querySelector<HTMLElement>("span[data-bold='1']");
			expect(span?.textContent).toBe("loud");
		}
	});

	it("falls back to the plain text (and placeholder) when rich is absent", () => {
		const c = buildNodeContent(document, sticky, t);
		const body = c.children[0] as HTMLElement;
		expect(body.querySelector("span")).toBeNull();
		expect(body.textContent).toBe("plan");
	});
});

describe("styles.css — node-chrome tokens always carry a fallback", () => {
	const css = readFileSync(join(__dirname, "../styles.css"), "utf8");

	/** Pull the body of every `.whiteboard__node…` / frame-header rule. */
	const nodeRules = [...css.matchAll(/\.whiteboard__(?:node|frame-header)[^{}]*\{([^}]*)\}/g)].map(
		(m) => m[1] ?? "",
	);

	it("matched a meaningful number of node rules (regex didn't silently break)", () => {
		expect(nodeRules.length).toBeGreaterThan(8);
	});

	for (const property of ["background", "color", "border-color", "border"]) {
		it(`every \`${property}\` token reference in node chrome has a fallback`, () => {
			const offenders: string[] = [];
			for (const body of nodeRules) {
				// Each declaration of this property within a node rule.
				const decls = body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:[^;]*`, "g"));
				if (!decls) continue;
				for (const decl of decls) {
					// A `var(--x)` with no comma before its closing paren has
					// no fallback. `var(--x, …)` (incl. nested var) is fine.
					if (/var\(\s*--[\w-]+\s*\)/.test(decl)) offenders.push(decl.trim());
				}
			}
			expect(offenders).toEqual([]);
		});
	}

	it("the base node fill + text colour specifically carry literals", () => {
		const baseRule = css.match(/\.whiteboard__node\s*\{([^}]*)\}/)?.[1] ?? "";
		expect(baseRule).toMatch(/background:\s*var\(--bg-elev,\s*#[0-9a-fA-F]{3,8}\)/);
		expect(baseRule).toMatch(/color:\s*var\(--text,\s*#[0-9a-fA-F]{3,8}\)/);
	});
});
