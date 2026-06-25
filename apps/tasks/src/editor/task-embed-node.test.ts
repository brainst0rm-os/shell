// @vitest-environment jsdom
import { createHeadlessEditor } from "@lexical/headless";
import { describe, expect, it } from "vitest";
import {
	SHELL_ENTITY_CARD_BLOCK_ID,
	type SerializedTaskEmbedNode,
	TASK_EMBED_NODE_TYPE,
	TaskEmbedNode,
} from "./task-embed-node";

function serialized(over: Partial<SerializedTaskEmbedNode>): SerializedTaskEmbedNode {
	return {
		type: TASK_EMBED_NODE_TYPE,
		version: 1,
		blockId: "io.brainstorm.tasks/inline-task",
		entityId: "task-1",
		entityType: "brainstorm/Task/v1",
		label: "Ship spec",
		...over,
	};
}

/** Lexical requires an active editor while creating nodes (so it can issue a
 *  key + reach pending-state); run each body inside a throwaway editor's
 *  `update()`. Mirrors Notes' `block-embed-node.test.ts` `withEditor`. */
function withEditor<T>(fn: () => T): T {
	const e = createHeadlessEditor({
		namespace: "task-embed-node-test",
		nodes: [TaskEmbedNode],
		onError: (err) => {
			throw err;
		},
	});
	let result: T | undefined;
	e.update(
		() => {
			result = fn();
		},
		{ discrete: true },
	);
	return result as T;
}

describe("TaskEmbedNode", () => {
	it("round-trips its reference fields through export/import JSON", () => {
		const out = withEditor(() => TaskEmbedNode.importJSON(serialized({})).exportJSON());
		expect(out.type).toBe(TASK_EMBED_NODE_TYPE);
		expect(out.blockId).toBe("io.brainstorm.tasks/inline-task");
		expect(out.entityId).toBe("task-1");
		expect(out.entityType).toBe("brainstorm/Task/v1");
		expect(out.label).toBe("Ship spec");
	});

	it("defaults a missing blockId to the shell entity-card on import", () => {
		const blockId = withEditor(() =>
			TaskEmbedNode.importJSON(serialized({ blockId: "" })).getBlockId(),
		);
		expect(blockId).toBe(SHELL_ENTITY_CARD_BLOCK_ID);
	});

	it("clamps an over-long label to the 1024-char ceiling", () => {
		const len = withEditor(
			() => TaskEmbedNode.importJSON(serialized({ label: "x".repeat(5000) })).getLabel().length,
		);
		expect(len).toBe(1024);
	});

	it("strips bidi-override / zero-width format controls from the label (Trojan-Source fence)", () => {
		const label = withEditor(() =>
			TaskEmbedNode.importJSON(serialized({ label: "Q3‮Report​" })).getLabel(),
		);
		expect(label).toBe("Q3Report");
	});

	it("getTextContent returns the human label, not a URI", () => {
		const text = withEditor(() =>
			TaskEmbedNode.importJSON(serialized({ label: "Readable" })).getTextContent(),
		);
		expect(text).toBe("Readable");
	});

	it("is a block node (not inline)", () => {
		const inline = withEditor(() => TaskEmbedNode.importJSON(serialized({})).isInline());
		expect(inline).toBe(false);
	});
});
