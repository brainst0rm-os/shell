// @vitest-environment jsdom
/**
 * Icon registry completeness + both renderers. The DOM twin must paint the
 * SAME glyph as the React `<Icon>` for every enum entry (mirrors the
 * shell's `ui/icon.tsx` contract); unknown names degrade quietly.
 */

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIconElement } from "./create-icon-element";
import { Icon } from "./icon";
import { ICON_GLYPHS } from "./icon-glyphs";
import { ALL_ICON_NAMES, ICON_ASSET, IconDirection, IconName, IconWeight } from "./icon-registry";

describe("icon registry", () => {
	it("covers every IconName in both the asset map and the glyph data", () => {
		for (const name of ALL_ICON_NAMES) {
			expect(ICON_ASSET[name], `asset for ${name}`).toBeTruthy();
			const glyph = ICON_GLYPHS[name];
			expect(glyph, `glyph for ${name}`).toBeTruthy();
			for (const w of Object.values(IconWeight)) {
				expect(glyph?.[w], `${name}/${w} markup`).toMatch(/<(path|circle|rect|line|polyline)/);
			}
		}
	});

	it("has no glyph keys outside the enum", () => {
		const enumValues = new Set<string>(ALL_ICON_NAMES);
		for (const key of Object.keys(ICON_GLYPHS)) {
			expect(enumValues.has(key), `stray glyph key ${key}`).toBe(true);
		}
	});
});

describe("createIconElement", () => {
	it("builds an SVG with the requested size, weight and class", () => {
		const el = createIconElement(IconName.Settings, {
			size: 24,
			weight: IconWeight.Bold,
			className: "x",
		});
		expect(el.tagName.toLowerCase()).toBe("svg");
		expect(el.getAttribute("width")).toBe("24");
		expect(el.getAttribute("height")).toBe("24");
		expect(el.getAttribute("viewBox")).toBe("0 0 256 256");
		expect(el.getAttribute("class")).toBe("x");
		expect(el.getAttribute("aria-hidden")).toBe("true");
		const boldD = ICON_GLYPHS[IconName.Settings]?.bold.match(/\bd="([^"]+)"/)?.[1];
		expect(el.querySelector("path")?.getAttribute("d")).toBe(boldD);
	});

	const pathD = (markup: string): string | null => {
		const m = markup.match(/\bd="([^"]+)"/);
		return m?.[1] ?? null;
	};

	it("defaults to size 16, regular weight, currentColor", () => {
		const el = createIconElement(IconName.Close);
		expect(el.getAttribute("width")).toBe("16");
		expect(el.getAttribute("fill")).toBe("currentColor");
		const d = el.querySelector("path")?.getAttribute("d");
		expect(d).toBe(pathD(ICON_GLYPHS[IconName.Close]?.regular ?? ""));
	});

	it("falls back to regular markup for an unknown weight (cast)", () => {
		const el = createIconElement(IconName.Plus, {
			weight: "wibble" as IconWeight,
		});
		const d = (el as SVGSVGElement).querySelector("path")?.getAttribute("d");
		expect(d).toBe(pathD(ICON_GLYPHS[IconName.Plus]?.regular ?? ""));
	});

	it("warns in dev and returns a hidden marker span for an unknown name", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const el = createIconElement("nope" as IconName);
		expect(el.tagName.toLowerCase()).toBe("span");
		expect(el.dataset.iconMissing).toBe("true");
		expect(warn).toHaveBeenCalledWith("[icon] unknown icon name: nope");
		warn.mockRestore();
	});

	it("does not stamp data-icon-direction when direction is omitted (12.5 RTL)", () => {
		const el = createIconElement(IconName.CaretLeft);
		// Default `Auto` — glyph stays bidirectional; the RTL mirror rule
		// in styles.css / app-theme.css only matches stamped elements.
		expect((el as SVGSVGElement).dataset.iconDirection).toBeUndefined();
	});

	it("stamps data-icon-direction=inline for IconDirection.Inline (12.5 RTL)", () => {
		const el = createIconElement(IconName.CaretLeft, { direction: IconDirection.Inline });
		expect((el as SVGSVGElement).dataset.iconDirection).toBe("inline");
	});

	it("does not stamp data-icon-direction for IconDirection.Auto (12.5 RTL)", () => {
		const el = createIconElement(IconName.CaretRight, { direction: IconDirection.Auto });
		expect((el as SVGSVGElement).dataset.iconDirection).toBeUndefined();
	});
});

describe("<Icon>", () => {
	let host: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
	});
	afterEach(() => {
		act(() => root.unmount());
		host.remove();
	});

	it("renders a phosphor svg for a known name", () => {
		act(() => root.render(<Icon name={IconName.Search} size={20} />));
		const svg = host.querySelector("svg");
		expect(svg).not.toBeNull();
		expect(svg?.getAttribute("width")).toBe("20");
	});

	it("renders nothing and warns for an unknown name", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		act(() => root.render(<Icon name={"bogus" as unknown as IconName} />));
		expect(host.querySelector("svg")).toBeNull();
		expect(warn).toHaveBeenCalledWith("[icon] unknown icon name: bogus");
		warn.mockRestore();
	});

	it("does not stamp data-icon-direction by default (12.5 RTL)", () => {
		act(() => root.render(<Icon name={IconName.CaretLeft} />));
		const svg = host.querySelector("svg");
		expect(svg?.getAttribute("data-icon-direction")).toBeNull();
	});

	it("stamps data-icon-direction=inline when direction=Inline (12.5 RTL)", () => {
		act(() => root.render(<Icon name={IconName.CaretLeft} direction={IconDirection.Inline} />));
		const svg = host.querySelector("svg");
		expect(svg?.getAttribute("data-icon-direction")).toBe("inline");
	});

	it("does not stamp data-icon-direction when direction=Auto (12.5 RTL)", () => {
		act(() => root.render(<Icon name={IconName.CaretRight} direction={IconDirection.Auto} />));
		const svg = host.querySelector("svg");
		expect(svg?.getAttribute("data-icon-direction")).toBeNull();
	});
});
