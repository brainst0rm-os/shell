/**
 * AudioBlockNode — top-level audio attachment with a native player.
 * Source is an uploaded `brainstorm://app-file/...` URL (or, under the
 * inline cap, a data URL) produced by `resolveBinarySrc`. Mirrors the
 * image/video block integration (selection / clipboard / move / dup via
 * exportJSON/importJSON).
 */

import {
	DecoratorNode,
	type EditorConfig,
	type LexicalNode,
	type NodeKey,
	type SerializedLexicalNode,
} from "lexical";
import type { JSX } from "react";

export const AUDIO_BLOCK_TYPE = "audio-block";
const AUDIO_BLOCK_VERSION = 1 as const;

export type SerializedAudioBlockNode = SerializedLexicalNode & {
	type: typeof AUDIO_BLOCK_TYPE;
	version: typeof AUDIO_BLOCK_VERSION;
	src: string;
	mime: string;
	name: string;
};

export class AudioBlockNode extends DecoratorNode<JSX.Element> {
	__src: string;
	__mime: string;
	__name: string;

	static override getType(): string {
		return AUDIO_BLOCK_TYPE;
	}

	static override clone(node: AudioBlockNode): AudioBlockNode {
		return new AudioBlockNode(node.__src, node.__mime, node.__name, node.__key);
	}

	constructor(src: string, mime = "", name = "", key?: NodeKey) {
		super(key);
		this.__src = src;
		this.__mime = mime;
		this.__name = name;
	}

	static override importJSON(s: SerializedAudioBlockNode): AudioBlockNode {
		return new AudioBlockNode(s.src, s.mime ?? "", s.name ?? "");
	}

	override exportJSON(): SerializedAudioBlockNode {
		return {
			type: AUDIO_BLOCK_TYPE,
			version: AUDIO_BLOCK_VERSION,
			src: this.__src,
			mime: this.__mime,
			name: this.__name,
		};
	}

	override createDOM(_config: EditorConfig): HTMLElement {
		const el = document.createElement("div");
		el.className = "notes__audio-host";
		return el;
	}

	override updateDOM(): false {
		return false;
	}

	getSrc(): string {
		return this.__src;
	}

	override decorate(): JSX.Element {
		return (
			<figure className="notes__audio">
				{/* biome-ignore lint/a11y/useMediaCaption: user-supplied audio has no caption track; the filename is the accessible label. */}
				<audio
					className="notes__audio-player"
					src={this.__src}
					controls
					preload="metadata"
					aria-label={this.__name || this.__src}
				/>
				{this.__name && <figcaption className="notes__audio-name">{this.__name}</figcaption>}
			</figure>
		);
	}

	override isInline(): false {
		return false;
	}
}

export function $createAudioBlockNode(src: string, mime = "", name = ""): AudioBlockNode {
	return new AudioBlockNode(src, mime, name);
}

export function $isAudioBlockNode(node: LexicalNode | null | undefined): node is AudioBlockNode {
	return node instanceof AudioBlockNode;
}
