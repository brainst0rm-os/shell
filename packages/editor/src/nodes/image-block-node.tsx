/**
 * ImageBlockNode — Lexical `DecoratorNode` for a top-level image with
 * optional caption, alignment, and width %.
 *
 * Source values:
 *   - `brainstorm://app-file/...` URL produced by the host uploader.
 *   - Or a base64 data URL for files under the inline cap (≤ 2 MiB).
 *
 * The `MediaInspectorPlugin` edits `alt` / `caption` / `alignment` /
 * `widthPercent` via the matching `set*` methods; it opens when the
 * figure is clicked.
 *
 * Plays nicely with the existing block-level machinery:
 *   - Top-level → `BlockSelectionPlugin` Cmd-click / Shift-click work.
 *   - Has `exportJSON` / `importJSON` → clipboard + duplicate + move
 *     round-trip without extra wiring.
 *   - The gutter walks top-level blocks by Y-coord; it picks the image.
 *
 * Turn-into commands skip this node (Lexical's `$setBlocksType` ignores
 * decorators) — to convert an image into another block, the user
 * deletes it first.
 */

import {
	type DOMConversionMap,
	DecoratorNode,
	type EditorConfig,
	type LexicalNode,
	type NodeKey,
	type SerializedLexicalNode,
} from "lexical";
import type { JSX } from "react";
import { useEditorT } from "../i18n";
import { MediaKind, mediaInspectorStore } from "../media-inspector-store";
import {
	DEFAULT_MEDIA_ALIGNMENT,
	DEFAULT_MEDIA_WIDTH_PERCENT,
	type MediaAlignment,
	clampMediaWidth,
	isMediaAlignment,
} from "../media-types";

export const IMAGE_BLOCK_TYPE = "image-block";

export type SerializedImageBlockNode = SerializedLexicalNode & {
	type: typeof IMAGE_BLOCK_TYPE;
	version: 2;
	src: string;
	alt: string;
	caption: string;
	alignment: MediaAlignment;
	widthPercent: number;
};

export class ImageBlockNode extends DecoratorNode<JSX.Element> {
	__src: string;
	__alt: string;
	__caption: string;
	__alignment: MediaAlignment;
	__widthPercent: number;

	static override getType(): string {
		return IMAGE_BLOCK_TYPE;
	}

	static override clone(node: ImageBlockNode): ImageBlockNode {
		return new ImageBlockNode(
			node.__src,
			node.__alt,
			node.__caption,
			node.__alignment,
			node.__widthPercent,
			node.__key,
		);
	}

	constructor(
		src: string,
		alt = "",
		caption = "",
		alignment: MediaAlignment = DEFAULT_MEDIA_ALIGNMENT,
		widthPercent: number = DEFAULT_MEDIA_WIDTH_PERCENT,
		key?: NodeKey,
	) {
		super(key);
		this.__src = src;
		this.__alt = alt;
		this.__caption = caption;
		this.__alignment = alignment;
		this.__widthPercent = clampMediaWidth(widthPercent);
	}

	static override importJSON(serialized: SerializedImageBlockNode): ImageBlockNode {
		// v1 lacked `alignment` + `widthPercent` — default them. Unknown
		// alignment values (forward-compat corrupt data) clamp to Center.
		const alignment = isMediaAlignment(serialized.alignment)
			? serialized.alignment
			: DEFAULT_MEDIA_ALIGNMENT;
		const widthPercent =
			typeof serialized.widthPercent === "number"
				? clampMediaWidth(serialized.widthPercent)
				: DEFAULT_MEDIA_WIDTH_PERCENT;
		return new ImageBlockNode(
			serialized.src,
			serialized.alt,
			serialized.caption,
			alignment,
			widthPercent,
		);
	}

	override exportJSON(): SerializedImageBlockNode {
		return {
			type: IMAGE_BLOCK_TYPE,
			version: 2,
			src: this.__src,
			alt: this.__alt,
			caption: this.__caption,
			alignment: this.__alignment,
			widthPercent: this.__widthPercent,
		};
	}

	static override importDOM(): DOMConversionMap | null {
		return null;
	}

	override createDOM(config: EditorConfig): HTMLElement {
		const el = document.createElement("div");
		const themeClass = config.theme.imageBlock;
		el.className = typeof themeClass === "string" ? themeClass : "notes__image-block";
		return el;
	}

	override updateDOM(): false {
		return false;
	}

	getSrc(): string {
		return this.__src;
	}

	getAlt(): string {
		return this.__alt;
	}

	getCaption(): string {
		return this.__caption;
	}

	getAlignment(): MediaAlignment {
		return this.__alignment;
	}

	getWidthPercent(): number {
		return this.__widthPercent;
	}

	setSrc(src: string): void {
		const writable = this.getWritable();
		writable.__src = src;
	}

	setAlt(alt: string): void {
		const writable = this.getWritable();
		writable.__alt = alt;
	}

	setCaption(caption: string): void {
		const writable = this.getWritable();
		writable.__caption = caption;
	}

	setAlignment(alignment: MediaAlignment): void {
		const writable = this.getWritable();
		writable.__alignment = alignment;
	}

	setWidthPercent(widthPercent: number): void {
		const writable = this.getWritable();
		writable.__widthPercent = clampMediaWidth(widthPercent);
	}

	override decorate(): JSX.Element {
		return (
			<ImageBlockView
				nodeKey={this.getKey()}
				src={this.__src}
				alt={this.__alt}
				caption={this.__caption}
				alignment={this.__alignment}
				widthPercent={this.__widthPercent}
			/>
		);
	}

	override isInline(): false {
		return false;
	}
}

function ImageBlockView({
	nodeKey,
	src,
	alt,
	caption,
	alignment,
	widthPercent,
}: {
	nodeKey: NodeKey;
	src: string;
	alt: string;
	caption: string;
	alignment: MediaAlignment;
	widthPercent: number;
}) {
	const t = useEditorT();
	function openInspector(currentTarget: HTMLElement) {
		const figure = currentTarget.closest("figure") ?? currentTarget;
		const anchor = figure.getBoundingClientRect();
		mediaInspectorStore.open({ nodeKey, kind: MediaKind.Image, anchor });
	}
	return (
		<figure
			className="notes__image"
			data-alignment={alignment}
			style={{ "--notes-media-width": `${widthPercent}%` } as Record<string, string>}
		>
			<button
				type="button"
				className="notes__media-edit-button"
				aria-label={t("editor.media.inspector.region")}
				onClick={(event) => openInspector(event.currentTarget)}
			>
				<img src={src} alt={alt} draggable={false} />
			</button>
			{caption && <figcaption className="notes__image-caption">{caption}</figcaption>}
		</figure>
	);
}

export function $createImageBlockNode(
	src: string,
	alt = "",
	caption = "",
	alignment: MediaAlignment = DEFAULT_MEDIA_ALIGNMENT,
	widthPercent: number = DEFAULT_MEDIA_WIDTH_PERCENT,
): ImageBlockNode {
	return new ImageBlockNode(src, alt, caption, alignment, widthPercent);
}

export function $isImageBlockNode(node: LexicalNode | null | undefined): node is ImageBlockNode {
	return node instanceof ImageBlockNode;
}
