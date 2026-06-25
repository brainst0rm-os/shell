import { describe, expect, it } from "vitest";
import { NodeKind, type WhiteboardNode } from "../types/node";
import { BOARD_TEMPLATES, BoardTemplate, buildTemplate } from "./templates";

const kinds = (nodes: WhiteboardNode[]) => nodes.map((n) => n.kind);

describe("buildTemplate", () => {
	it("Blank is an empty scene", () => {
		const out = buildTemplate(BoardTemplate.Blank);
		expect(out.nodes).toEqual([]);
		expect(out.edges).toEqual([]);
	});

	it("Kanban lays out three titled frames + a seed card", () => {
		const out = buildTemplate(BoardTemplate.Kanban);
		const frames = out.nodes.filter((n) => n.kind === NodeKind.Frame);
		expect(frames).toHaveLength(3);
		expect(frames.map((f) => (f as { title: string }).title)).toEqual(["To do", "Doing", "Done"]);
		expect(out.nodes.some((n) => n.kind === NodeKind.Sticky)).toBe(true);
		// Frames march left-to-right at the deterministic column pitch (no overlap).
		expect(frames.map((f) => f.x)).toEqual([80, 412, 744]);
		expect(out.edges).toEqual([]);
	});

	it("Flowchart chains four nodes with three connectors", () => {
		const out = buildTemplate(BoardTemplate.Flowchart);
		expect(out.nodes).toHaveLength(4);
		expect(out.edges).toHaveLength(3);
		// Each connector references real, distinct node ids in the scene.
		const ids = new Set(out.nodes.map((n) => n.id));
		for (const e of out.edges) {
			expect(ids.has(e.sourceNodeId)).toBe(true);
			expect(ids.has(e.destNodeId)).toBe(true);
			expect(e.sourceNodeId).not.toBe(e.destNodeId);
		}
		// A rectangle shape sits in the chain.
		expect(kinds(out.nodes)).toContain(NodeKind.Shape);
	});

	it("Mind map links a centre to four branches", () => {
		const out = buildTemplate(BoardTemplate.MindMap);
		expect(out.nodes).toHaveLength(5);
		expect(out.edges).toHaveLength(4);
		// Every edge fans out from the same single source (the centre).
		const sources = new Set(out.edges.map((e) => e.sourceNodeId));
		expect(sources.size).toBe(1);
	});

	it("every catalog entry builds without throwing + ids are unique", () => {
		for (const template of BOARD_TEMPLATES) {
			const out = buildTemplate(template);
			const ids = out.nodes.map((n) => n.id);
			expect(new Set(ids).size).toBe(ids.length);
		}
	});
});
