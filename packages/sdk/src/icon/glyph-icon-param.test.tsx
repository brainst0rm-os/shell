// @vitest-environment jsdom
import { createElement } from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { glyphIconParam } from "./glyph-icon-param";

describe("glyphIconParam", () => {
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

	it("renders the spec's paths as a stroked svg component fancy-menus can paint", () => {
		const param = glyphIconParam({
			viewBox: "0 0 16 16",
			paths: ["M3 3h10v7l-3 3H3z", "M13 10h-3v3"],
			strokeWidth: 1.5,
		});
		act(() => root.render(createElement(param.icon, { size: 18 })));
		const svg = host.querySelector("svg");
		expect(svg).not.toBeNull();
		expect(svg?.getAttribute("viewBox")).toBe("0 0 16 16");
		expect(svg?.getAttribute("width")).toBe("18");
		expect(svg?.getAttribute("fill")).toBe("none");
		expect(svg?.getAttribute("stroke")).toBe("currentColor");
		expect(host.querySelectorAll("path")).toHaveLength(2);
	});

	it("returns a stable component identity across calls for the same param", () => {
		const param = glyphIconParam({ viewBox: "0 0 16 16", paths: ["M0 0"] });
		expect(param.icon).toBe(param.icon);
	});
});
