import { describe, expect, it } from "vitest";
import { createBrainstormHeadlessEditor } from "./headless";
import { $createImageNode, $isImageNode, ImageNode, type SerializedImageNode } from "./image-node";

/** Lexical 0.21 node ops (construct / exportJSON / clone) must run inside
 *  an active editor; run the body in a discrete read/update. */
function inEditor<T>(fn: () => T): T {
	const editor = createBrainstormHeadlessEditor();
	let out!: T;
	editor.update(
		() => {
			out = fn();
		},
		{ discrete: true },
	);
	return out;
}

describe("ImageNode", () => {
	it("has the stable baseline type", () => {
		expect(ImageNode.getType()).toBe("image");
	});

	it("applies defaults for caption + width", () => {
		const json = inEditor(() => $createImageNode({ src: "s", altText: "a" }).exportJSON());
		expect(json).toEqual({
			type: "image",
			version: 1,
			src: "s",
			altText: "a",
			caption: "",
			width: "inherit",
		});
	});

	it("round-trips exportJSON → importJSON", () => {
		const { a, b } = inEditor(() => {
			const node = $createImageNode({ src: "s", altText: "a", caption: "c", width: 200 });
			const exported = node.exportJSON();
			return { a: exported, b: ImageNode.importJSON(exported).exportJSON() };
		});
		expect(b).toEqual(a);
	});

	it("coerces a malformed serialized width back to 'inherit'", () => {
		const width = inEditor(
			() =>
				ImageNode.importJSON({
					type: "image",
					version: 1,
					src: "s",
					altText: "a",
					caption: "",
					width: "huge",
				} as unknown as SerializedImageNode).exportJSON().width,
		);
		expect(width).toBe("inherit");
	});

	it("clone copies every field", () => {
		const { same, identity } = inEditor(() => {
			const node = $createImageNode({ src: "s", altText: "a", caption: "c", width: 100 });
			const clone = ImageNode.clone(node);
			return {
				same: JSON.stringify(clone.exportJSON()) === JSON.stringify(node.exportJSON()),
				identity: clone === node,
			};
		});
		expect(same).toBe(true);
		expect(identity).toBe(false);
	});

	it("$isImageNode narrows correctly", () => {
		const isImage = inEditor(() => $isImageNode($createImageNode({ src: "s", altText: "a" })));
		expect(isImage).toBe(true);
		expect($isImageNode(null)).toBe(false);
		expect($isImageNode(undefined)).toBe(false);
	});
});
