// @vitest-environment jsdom
import { createHeadlessEditor } from "@lexical/headless";
import { $createParagraphNode, $getRoot } from "lexical";
import { describe, expect, it } from "vitest";
import { applyTaskEmbedInsertion } from "./task-embed-insert";
import { $isTaskEmbedNode, TaskEmbedNode } from "./task-embed-node";

function editor() {
	return createHeadlessEditor({
		namespace: "task-embed-insert-test",
		nodes: [TaskEmbedNode],
		onError: (e) => {
			throw e;
		},
	});
}

describe("applyTaskEmbedInsertion", () => {
	it("replaces the target paragraph with a TaskEmbedNode", () => {
		const ed = editor();
		let paragraphKey = "";
		ed.update(
			() => {
				const p = $createParagraphNode();
				$getRoot().append(p);
				paragraphKey = p.getKey();
			},
			{ discrete: true },
		);
		applyTaskEmbedInsertion(ed, paragraphKey, {
			entityId: "task-7",
			entityType: "brainstorm/Task/v1",
			label: "Ship spec",
			blockId: "io.brainstorm.tasks/inline-task",
		});
		ed.getEditorState().read(() => {
			const children = $getRoot().getChildren();
			expect(children).toHaveLength(1);
			const node = children[0];
			expect($isTaskEmbedNode(node)).toBe(true);
			if ($isTaskEmbedNode(node)) {
				expect(node.getEntityId()).toBe("task-7");
				expect(node.getBlockId()).toBe("io.brainstorm.tasks/inline-task");
				expect(node.getLabel()).toBe("Ship spec");
			}
		});
	});

	it("falls back to root-append when the paragraph key is missing", () => {
		const ed = editor();
		ed.update(
			() => {
				$getRoot().append($createParagraphNode());
			},
			{ discrete: true },
		);
		applyTaskEmbedInsertion(ed, null, {
			entityId: "task-9",
			entityType: "brainstorm/Task/v1",
			label: "Orphan",
		});
		ed.getEditorState().read(() => {
			const embeds = $getRoot()
				.getChildren()
				.filter((n) => $isTaskEmbedNode(n));
			expect(embeds).toHaveLength(1);
		});
	});

	it("defaults to the shell entity-card block id when none is supplied", () => {
		const ed = editor();
		let paragraphKey = "";
		ed.update(
			() => {
				const p = $createParagraphNode();
				$getRoot().append(p);
				paragraphKey = p.getKey();
			},
			{ discrete: true },
		);
		applyTaskEmbedInsertion(ed, paragraphKey, {
			entityId: "task-1",
			entityType: "brainstorm/Task/v1",
			label: "Default block",
		});
		ed.getEditorState().read(() => {
			const node = $getRoot().getChildren()[0];
			if ($isTaskEmbedNode(node)) {
				expect(node.getBlockId()).toBe("io.brainstorm.shell/entity-card/v1");
			} else {
				throw new Error("expected a TaskEmbedNode");
			}
		});
	});
});
