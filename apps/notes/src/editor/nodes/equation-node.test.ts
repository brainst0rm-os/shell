// @vitest-environment jsdom
import { createHeadlessEditor } from "@lexical/headless";
import {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	$isElementNode,
	type LexicalEditor,
	type LexicalNode,
} from "lexical";
import { describe, expect, it } from "vitest";
import { EQUATION_TRANSFORMER } from "../equation-transformer";
import { $createEquationNode, $isEquationNode, EquationNode } from "./equation-node";

function editor(): LexicalEditor {
	return createHeadlessEditor({
		namespace: "eq",
		nodes: [EquationNode],
		onError: (e) => {
			throw e;
		},
	});
}

describe("EquationNode", () => {
	it("round-trips equation + inline flag (both variants)", () => {
		for (const inline of [true, false]) {
			const e = editor();
			e.update(
				() => {
					$getRoot().append($createEquationNode("a^2 + b^2", inline));
				},
				{ discrete: true },
			);
			const json = JSON.stringify(e.getEditorState().toJSON());
			const next = editor();
			next.setEditorState(next.parseEditorState(json));
			next.getEditorState().read(() => {
				const n = $getRoot().getFirstChild();
				expect($isEquationNode(n)).toBe(true);
				if ($isEquationNode(n)) {
					expect(n.getEquation()).toBe("a^2 + b^2");
					expect(n.isInline()).toBe(inline);
				}
			});
		}
	});

	it("setEquation mutates and serialises", () => {
		const e = editor();
		e.update(
			() => {
				const node = $createEquationNode("x", true);
				$getRoot().append(node);
				node.setEquation("y^2");
			},
			{ discrete: true },
		);
		e.getEditorState().read(() => {
			const n = $getRoot().getFirstChild();
			expect($isEquationNode(n) && n.exportJSON()).toMatchObject({
				type: "equation",
				equation: "y^2",
				inline: true,
			});
		});
	});
});

describe("EQUATION_TRANSFORMER", () => {
	it("exports inline equations to $…$ and ignores block ones", () => {
		const e = editor();
		e.update(
			() => {
				const inline = $createEquationNode("E=mc^2", true);
				const block = $createEquationNode("E=mc^2", false);
				$getRoot().append($createParagraphNode().append(inline));
				$getRoot().append($createParagraphNode().append(block));
			},
			{ discrete: true },
		);
		const firstChild = (n: LexicalNode | undefined) =>
			n && $isElementNode(n) ? n.getFirstChild() : null;
		e.getEditorState().read(() => {
			const [p1, p2] = $getRoot().getChildren();
			const noop = () => "";
			expect(
				EQUATION_TRANSFORMER.export?.(firstChild(p1) as never, noop as never, noop as never),
			).toBe("$E=mc^2$");
			expect(
				EQUATION_TRANSFORMER.export?.(firstChild(p2) as never, noop as never, noop as never),
			).toBeNull();
		});
	});

	it("regExp matches a closed $…$ run", () => {
		expect("$x+1$".match(EQUATION_TRANSFORMER.regExp)?.[1]).toBe("x+1");
		expect("no math here".match(EQUATION_TRANSFORMER.regExp)).toBeNull();
	});

	it("replace swaps the text node for an inline EquationNode", () => {
		const e = editor();
		e.update(
			() => {
				const text = $createTextNode("$a+b$");
				$getRoot().append($createParagraphNode().append(text));
				const match = "$a+b$".match(/\$([^$]+?)\$/) as RegExpMatchArray;
				EQUATION_TRANSFORMER.replace?.(text, match);
			},
			{ discrete: true },
		);
		e.getEditorState().read(() => {
			const para = $getRoot().getFirstChild();
			const child = para && $isElementNode(para) ? para.getFirstChild() : null;
			expect($isEquationNode(child)).toBe(true);
			if ($isEquationNode(child)) {
				expect(child.getEquation()).toBe("a+b");
				expect(child.isInline()).toBe(true);
			}
		});
	});
});
