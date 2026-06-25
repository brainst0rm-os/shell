/**
 * FileBlockNode — a download chip for any non-media attachment (zip,
 * pdf, docx, …). Source is an uploaded `brainstorm://app-file/...` URL
 * (or an inline data URL under the cap). Renders an `<a download>` so
 * the shell handles the save, consistent with how external links open.
 */

import {
	DecoratorNode,
	type EditorConfig,
	type LexicalNode,
	type NodeKey,
	type SerializedLexicalNode,
} from "lexical";
import type { JSX } from "react";
import { FileIcon } from "../icons";

export const FILE_BLOCK_TYPE = "file-block";
const FILE_BLOCK_VERSION = 1 as const;

export type SerializedFileBlockNode = SerializedLexicalNode & {
	type: typeof FILE_BLOCK_TYPE;
	version: typeof FILE_BLOCK_VERSION;
	src: string;
	name: string;
	size: number;
	mime: string;
};

/** 1.5 KB → "1.5 KB". Binary units; one decimal above KB. */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return "";
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB", "TB"];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export class FileBlockNode extends DecoratorNode<JSX.Element> {
	__src: string;
	__name: string;
	__size: number;
	__mime: string;

	static override getType(): string {
		return FILE_BLOCK_TYPE;
	}

	static override clone(node: FileBlockNode): FileBlockNode {
		return new FileBlockNode(node.__src, node.__name, node.__size, node.__mime, node.__key);
	}

	constructor(src: string, name = "", size = 0, mime = "", key?: NodeKey) {
		super(key);
		this.__src = src;
		this.__name = name;
		this.__size = size;
		this.__mime = mime;
	}

	static override importJSON(s: SerializedFileBlockNode): FileBlockNode {
		return new FileBlockNode(
			s.src,
			s.name ?? "",
			typeof s.size === "number" ? s.size : 0,
			s.mime ?? "",
		);
	}

	override exportJSON(): SerializedFileBlockNode {
		return {
			type: FILE_BLOCK_TYPE,
			version: FILE_BLOCK_VERSION,
			src: this.__src,
			name: this.__name,
			size: this.__size,
			mime: this.__mime,
		};
	}

	override createDOM(_config: EditorConfig): HTMLElement {
		const el = document.createElement("div");
		el.className = "notes__file-host";
		return el;
	}

	override updateDOM(): false {
		return false;
	}

	getSrc(): string {
		return this.__src;
	}

	override decorate(): JSX.Element {
		const meta = formatBytes(this.__size);
		return (
			<a
				className="notes__file"
				href={this.__src}
				download={this.__name || true}
				rel="noopener noreferrer"
			>
				<span className="notes__file-icon" aria-hidden="true">
					<FileIcon />
				</span>
				<span className="notes__file-text">
					<span className="notes__file-name">{this.__name || this.__src}</span>
					{meta && <span className="notes__file-size">{meta}</span>}
				</span>
			</a>
		);
	}

	override isInline(): false {
		return false;
	}
}

export function $createFileBlockNode(src: string, name = "", size = 0, mime = ""): FileBlockNode {
	return new FileBlockNode(src, name, size, mime);
}

export function $isFileBlockNode(node: LexicalNode | null | undefined): node is FileBlockNode {
	return node instanceof FileBlockNode;
}
