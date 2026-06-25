/**
 * VideoBlockNode — Lexical `DecoratorNode` for top-level inline video.
 * Mirrors `ImageBlockNode` (same selection / clipboard / move / dup
 * integration, same alignment + width inspector).
 *
 * Source is a `brainstorm://app-file/...` URL produced by the host
 * uploader — videos are typically >2 MiB so the data-URL fallback path
 * used by images doesn't apply here. If the upload fails the slash
 * command bails and the block never gets inserted.
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

export const VIDEO_BLOCK_TYPE = "video-block";

export type SerializedVideoBlockNode = SerializedLexicalNode & {
	type: typeof VIDEO_BLOCK_TYPE;
	version: 2;
	src: string;
	mime: string;
	caption: string;
	alignment: MediaAlignment;
	widthPercent: number;
};

export class VideoBlockNode extends DecoratorNode<JSX.Element> {
	__src: string;
	__mime: string;
	__caption: string;
	__alignment: MediaAlignment;
	__widthPercent: number;

	static override getType(): string {
		return VIDEO_BLOCK_TYPE;
	}

	static override clone(node: VideoBlockNode): VideoBlockNode {
		return new VideoBlockNode(
			node.__src,
			node.__mime,
			node.__caption,
			node.__alignment,
			node.__widthPercent,
			node.__key,
		);
	}

	constructor(
		src: string,
		mime = "",
		caption = "",
		alignment: MediaAlignment = DEFAULT_MEDIA_ALIGNMENT,
		widthPercent: number = DEFAULT_MEDIA_WIDTH_PERCENT,
		key?: NodeKey,
	) {
		super(key);
		this.__src = src;
		this.__mime = mime;
		this.__caption = caption;
		this.__alignment = alignment;
		this.__widthPercent = clampMediaWidth(widthPercent);
	}

	static override importJSON(serialized: SerializedVideoBlockNode): VideoBlockNode {
		const alignment = isMediaAlignment(serialized.alignment)
			? serialized.alignment
			: DEFAULT_MEDIA_ALIGNMENT;
		const widthPercent =
			typeof serialized.widthPercent === "number"
				? clampMediaWidth(serialized.widthPercent)
				: DEFAULT_MEDIA_WIDTH_PERCENT;
		return new VideoBlockNode(
			serialized.src,
			serialized.mime,
			serialized.caption,
			alignment,
			widthPercent,
		);
	}

	override exportJSON(): SerializedVideoBlockNode {
		return {
			type: VIDEO_BLOCK_TYPE,
			version: 2,
			src: this.__src,
			mime: this.__mime,
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
		const themeClass = config.theme.videoBlock;
		el.className = typeof themeClass === "string" ? themeClass : "notes__video-block";
		return el;
	}

	override updateDOM(): false {
		return false;
	}

	getSrc(): string {
		return this.__src;
	}

	getMime(): string {
		return this.__mime;
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

	setMime(mime: string): void {
		const writable = this.getWritable();
		writable.__mime = mime;
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
			<VideoBlockView
				nodeKey={this.getKey()}
				src={this.__src}
				mime={this.__mime}
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

function VideoBlockView({
	nodeKey,
	src,
	mime,
	caption,
	alignment,
	widthPercent,
}: {
	nodeKey: NodeKey;
	src: string;
	mime: string;
	caption: string;
	alignment: MediaAlignment;
	widthPercent: number;
}) {
	const t = useEditorT();
	function openInspector(currentTarget: HTMLElement) {
		const figure = currentTarget.closest("figure") ?? currentTarget;
		const anchor = figure.getBoundingClientRect();
		mediaInspectorStore.open({ nodeKey, kind: MediaKind.Video, anchor });
	}
	return (
		<figure
			className="notes__video"
			data-alignment={alignment}
			style={{ "--notes-media-width": `${widthPercent}%` } as Record<string, string>}
		>
			{/* biome-ignore lint/a11y/useMediaCaption: track captions are an inspector-level
				feature; v1 ships without forced empty <track> elements. */}
			<video controls preload="metadata">
				{mime ? <source src={src} type={mime} /> : <source src={src} />}
			</video>
			<button
				type="button"
				className="notes__media-edit-button notes__media-edit-button--overlay"
				aria-label={t("editor.media.inspector.region")}
				onClick={(event) => openInspector(event.currentTarget)}
			>
				<span aria-hidden="true">⋯</span>
			</button>
			{caption && <figcaption className="notes__video-caption">{caption}</figcaption>}
		</figure>
	);
}

export function $createVideoBlockNode(
	src: string,
	mime = "",
	caption = "",
	alignment: MediaAlignment = DEFAULT_MEDIA_ALIGNMENT,
	widthPercent: number = DEFAULT_MEDIA_WIDTH_PERCENT,
): VideoBlockNode {
	return new VideoBlockNode(src, mime, caption, alignment, widthPercent);
}

export function $isVideoBlockNode(node: LexicalNode | null | undefined): node is VideoBlockNode {
	return node instanceof VideoBlockNode;
}
