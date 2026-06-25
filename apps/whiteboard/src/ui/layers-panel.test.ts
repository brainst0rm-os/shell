/**
 * @vitest-environment jsdom
 *
 * F-197 regression pins for the layers panel:
 *
 *  1. the panel mounts hidden and renders NOTHING until opened (the
 *     dogfood vault showed an empty 240px box floating over every board);
 *  2. open shows the header (title + close affordance) and the rows /
 *     empty state;
 *  3. the stylesheet carries an explicit `.whiteboard__layers[hidden]`
 *     display:none rule — the original bug was the class's `display: flex`
 *     silently overriding the UA `[hidden]` style, so the "hidden" panel
 *     painted anyway.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WHITEBOARD_MANIFEST, type WhiteboardMessageKey, createT } from "../i18n/t";
import { buildLayerList } from "../logic/layer-list";
import { NodeKind, StickyColor, type WhiteboardNode } from "../types/node";
import { createLayersPanel } from "./layers-panel";

const t = createT();

function sticky(id: string, text: string): WhiteboardNode {
	return {
		id,
		kind: NodeKind.Sticky,
		x: 0,
		y: 0,
		width: 180,
		height: 180,
		text,
		color: StickyColor.Yellow,
	};
}

describe("createLayersPanel", () => {
	beforeEach(() => {
		document.body.replaceChildren();
	});

	it("mounts hidden with no rows (closed panel renders nothing)", () => {
		const panel = createLayersPanel({
			t,
			onClose: () => {},
			onToggleHidden: () => {},
			onSelectNode: () => {},
		});
		expect(panel.element.hidden).toBe(true);
		expect(panel.isOpen()).toBe(false);
		panel.renderRows(buildLayerList([sticky("a", "x")]), new Set());
		expect(panel.element.querySelectorAll(".whiteboard__layer").length).toBe(0);
	});

	it("open shows the header with title and a close affordance", () => {
		const onClose = vi.fn();
		const panel = createLayersPanel({
			t,
			onClose,
			onToggleHidden: () => {},
			onSelectNode: () => {},
		});
		panel.setOpen(true);
		expect(panel.element.hidden).toBe(false);
		const title = panel.element.querySelector(".whiteboard__layers-title");
		expect(title?.textContent).toBe(WHITEBOARD_MANIFEST["whiteboard.layers.title"]);
		const close = panel.element.querySelector<HTMLButtonElement>(".whiteboard__layers-close");
		expect(close).not.toBeNull();
		close?.click();
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("renders an explicit empty state on a board with no nodes", () => {
		const panel = createLayersPanel({
			t,
			onClose: () => {},
			onToggleHidden: () => {},
			onSelectNode: () => {},
		});
		panel.setOpen(true);
		panel.renderRows([], new Set());
		const empty = panel.element.querySelector(".whiteboard__layers-empty");
		expect(empty?.textContent).toBe(WHITEBOARD_MANIFEST["whiteboard.layers.empty"]);
	});

	it("renders rows with visibility toggle + select wiring and selection state", () => {
		const onToggleHidden = vi.fn();
		const onSelectNode = vi.fn();
		const panel = createLayersPanel({ t, onClose: () => {}, onToggleHidden, onSelectNode });
		panel.setOpen(true);
		const rows = buildLayerList([sticky("a", "Alpha"), sticky("b", "Beta")]);
		panel.renderRows(rows, new Set(["b"]));
		const items = panel.element.querySelectorAll<HTMLElement>(".whiteboard__layer");
		expect(items.length).toBe(2);
		const selected = panel.element.querySelector<HTMLElement>(
			'.whiteboard__layer[data-selected="true"]',
		);
		expect(selected?.dataset.nodeId).toBe("b");
		items[0]?.querySelector<HTMLButtonElement>(".whiteboard__layer-vis")?.click();
		expect(onToggleHidden).toHaveBeenCalledWith(items[0]?.dataset.nodeId);
		items[1]?.querySelector<HTMLButtonElement>(".whiteboard__layer-label")?.click();
		expect(onSelectNode).toHaveBeenCalledWith(items[1]?.dataset.nodeId);
	});

	it("re-renders only when the rows/selection change (paint-loop gate)", () => {
		const panel = createLayersPanel({
			t,
			onClose: () => {},
			onToggleHidden: () => {},
			onSelectNode: () => {},
		});
		panel.setOpen(true);
		const rows = buildLayerList([sticky("a", "Alpha"), sticky("b", "Beta")]);
		panel.renderRows(rows, new Set(["a"]));
		const first = panel.element.querySelector<HTMLElement>(".whiteboard__layer");
		// Same data → no rebuild: the live row node is reused, not replaced.
		panel.renderRows(buildLayerList([sticky("a", "Alpha"), sticky("b", "Beta")]), new Set(["a"]));
		expect(panel.element.querySelector(".whiteboard__layer")).toBe(first);
		// A selection change → rebuild (the node identity is replaced).
		panel.renderRows(rows, new Set(["b"]));
		expect(panel.element.querySelector(".whiteboard__layer")).not.toBe(first);
	});

	it("closing clears the rows and hides the element again", () => {
		const panel = createLayersPanel({
			t,
			onClose: () => {},
			onToggleHidden: () => {},
			onSelectNode: () => {},
		});
		panel.setOpen(true);
		panel.renderRows(buildLayerList([sticky("a", "Alpha")]), new Set());
		expect(panel.element.querySelectorAll(".whiteboard__layer").length).toBe(1);
		panel.setOpen(false);
		expect(panel.element.hidden).toBe(true);
		expect(panel.element.querySelectorAll(".whiteboard__layer").length).toBe(0);
	});

	it("styles.css pins .whiteboard__layers[hidden] to display:none (the F-197 root cause)", () => {
		const css = readFileSync(join(__dirname, "..", "styles.css"), "utf8");
		const rule = css.match(/\.whiteboard__layers\[hidden\]\s*\{[^}]*\}/);
		expect(rule, "missing .whiteboard__layers[hidden] rule").not.toBeNull();
		expect(rule?.[0]).toContain("display: none");
	});

	it("has a translated close label", () => {
		const key: WhiteboardMessageKey = "whiteboard.layers.close";
		expect(WHITEBOARD_MANIFEST[key]).toBeTruthy();
	});
});
