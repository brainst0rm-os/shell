/**
 * Baseline `ImageNode`. Lexical core has no image node, but "image" is in
 * the agreed baseline set (§baseline
 * nodes), so the shared editor owns a minimal one. Kept deliberately small
 * — the Notes app's heavier `ImageBlockNode` (caption editing, alignment,
 * resize handles) stays app-local; this is the cross-app lowest common
 * denominator that round-trips through Yjs and renders in previews.
 *
 * The serialized shape is the stable contract the read-only preview
 * renderer reads (it never instantiates Lexical), so all fields are
 * always present.
 */

import {
	type DOMExportOutput,
	DecoratorNode,
	type LexicalNode,
	type NodeKey,
	type SerializedLexicalNode,
	type Spread,
} from "lexical";
import type { ReactNode } from "react";
import { OffscreenGate } from "./decorator-unmount";
import { ESTIMATED_EMBED_PX } from "./height-cache";

export type ImageWidth = number | "inherit";

export type SerializedImageNode = Spread<
	{
		src: string;
		altText: string;
		caption: string;
		width: ImageWidth;
	},
	SerializedLexicalNode
>;

export class ImageNode extends DecoratorNode<ReactNode> {
	__src: string;
	__altText: string;
	__caption: string;
	__width: ImageWidth;

	static override getType(): string {
		return "image";
	}

	static override clone(node: ImageNode): ImageNode {
		return new ImageNode(node.__src, node.__altText, node.__caption, node.__width, node.__key);
	}

	constructor(
		src: string,
		altText: string,
		caption = "",
		width: ImageWidth = "inherit",
		key?: NodeKey,
	) {
		super(key);
		this.__src = src;
		this.__altText = altText;
		this.__caption = caption;
		this.__width = width;
	}

	static override importJSON(serialized: SerializedImageNode): ImageNode {
		return new ImageNode(
			typeof serialized.src === "string" ? serialized.src : "",
			typeof serialized.altText === "string" ? serialized.altText : "",
			typeof serialized.caption === "string" ? serialized.caption : "",
			serialized.width === "inherit" || typeof serialized.width === "number"
				? serialized.width
				: "inherit",
		);
	}

	override exportJSON(): SerializedImageNode {
		return {
			type: ImageNode.getType(),
			version: 1,
			src: this.__src,
			altText: this.__altText,
			caption: this.__caption,
			width: this.__width,
		};
	}

	override exportDOM(): DOMExportOutput {
		const img = document.createElement("img");
		img.setAttribute("src", this.__src);
		img.setAttribute("alt", this.__altText);
		return { element: img };
	}

	override createDOM(): HTMLElement {
		const span = document.createElement("span");
		span.className = "bs-editor__image";
		return span;
	}

	override updateDOM(): false {
		return false;
	}

	getSrc(): string {
		return this.__src;
	}

	getAltText(): string {
		return this.__altText;
	}

	override decorate(): ReactNode {
		const style = this.__width === "inherit" ? undefined : { width: `${this.__width}px` };
		const reserved = typeof this.__width === "number" ? this.__width : ESTIMATED_EMBED_PX;
		return (
			<OffscreenGate height={reserved}>
				<figure className="bs-editor__image">
					<img src={this.__src} alt={this.__altText} style={style} />
					{this.__caption ? (
						<figcaption className="bs-editor__image-caption">{this.__caption}</figcaption>
					) : null}
				</figure>
			</OffscreenGate>
		);
	}
}

export function $createImageNode(args: {
	src: string;
	altText: string;
	caption?: string;
	width?: ImageWidth;
}): ImageNode {
	return new ImageNode(args.src, args.altText, args.caption ?? "", args.width ?? "inherit");
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
	return node instanceof ImageNode;
}
