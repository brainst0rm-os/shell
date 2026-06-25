/**
 * WebEmbedNode — a sandboxed `<iframe>` for an allowlisted provider
 * (YouTube / Vimeo / Loom / Figma / CodeSandbox). The embeddable URL is
 * computed by `classifyUrl` at insert time and frozen on the node, so
 * the renderer never iframes an arbitrary origin and never needs the
 * network itself. The iframe is `sandbox`ed to the minimum the players
 * need and `referrerpolicy="no-referrer"`.
 */

import {
	DecoratorNode,
	type EditorConfig,
	type LexicalNode,
	type NodeKey,
	type SerializedLexicalNode,
} from "lexical";
import type { JSX } from "react";
import { EmbedKind, classifyUrl } from "../plugins/embed-providers";

export const WEB_EMBED_NODE_TYPE = "web-embed";
const WEB_EMBED_NODE_VERSION = 1 as const;

const KNOWN_KINDS = new Set<string>(Object.values(EmbedKind));

function coerceKind(raw: unknown): EmbedKind {
	return typeof raw === "string" && KNOWN_KINDS.has(raw) ? (raw as EmbedKind) : EmbedKind.Bookmark;
}

// The serialized `embedUrl` is attacker-controlled when it arrives via CRDT
// sync or clipboard paste, so it is never trusted: re-run the provider
// allowlist on the (also untrusted, but classified afresh) `url` and accept
// the iframe only when classifyUrl itself produces an embeddable provider —
// mirroring the insert path's embed-vs-bookmark decision in embed-plugin.tsx.
function reclassifyEmbed(
	rawUrl: unknown,
	rawKind: unknown,
): { embedUrl: string | null; kind: EmbedKind } {
	if (typeof rawUrl !== "string") return { embedUrl: null, kind: EmbedKind.Bookmark };
	const c = classifyUrl(rawUrl);
	if (!c || c.kind === EmbedKind.Bookmark || !c.embedUrl) {
		return { embedUrl: null, kind: EmbedKind.Bookmark };
	}
	const declared = coerceKind(rawKind);
	if (declared !== c.kind) return { embedUrl: null, kind: EmbedKind.Bookmark };
	return { embedUrl: c.embedUrl, kind: c.kind };
}

export type SerializedWebEmbedNode = SerializedLexicalNode & {
	type: typeof WEB_EMBED_NODE_TYPE;
	version: typeof WEB_EMBED_NODE_VERSION;
	url: string;
	embedUrl: string | null;
	kind: EmbedKind;
};

export class WebEmbedNode extends DecoratorNode<JSX.Element> {
	__url: string;
	__embedUrl: string | null;
	__kind: EmbedKind;

	static override getType(): string {
		return WEB_EMBED_NODE_TYPE;
	}

	static override clone(node: WebEmbedNode): WebEmbedNode {
		return new WebEmbedNode(node.__url, node.__embedUrl, node.__kind, node.__key);
	}

	constructor(url: string, embedUrl: string | null, kind: EmbedKind, key?: NodeKey) {
		super(key);
		this.__url = url;
		this.__embedUrl = embedUrl;
		this.__kind = kind;
	}

	static override importJSON(s: SerializedWebEmbedNode): WebEmbedNode {
		const { embedUrl, kind } = reclassifyEmbed(s.url, s.kind);
		return new WebEmbedNode(typeof s.url === "string" ? s.url : "", embedUrl, kind);
	}

	override exportJSON(): SerializedWebEmbedNode {
		return {
			type: WEB_EMBED_NODE_TYPE,
			version: WEB_EMBED_NODE_VERSION,
			url: this.__url,
			embedUrl: this.__embedUrl,
			kind: this.__kind,
		};
	}

	override createDOM(_config: EditorConfig): HTMLElement {
		const el = document.createElement("div");
		el.className = "notes__embed-host";
		return el;
	}

	override updateDOM(): false {
		return false;
	}

	override decorate(): JSX.Element {
		return <WebEmbedView url={this.__url} embedUrl={this.__embedUrl} kind={this.__kind} />;
	}

	override isInline(): false {
		return false;
	}
}

function WebEmbedView({
	url,
	embedUrl,
	kind,
}: {
	url: string;
	embedUrl: string | null;
	kind: EmbedKind;
}) {
	// A null embedUrl means the (re-validated) URL is not an allowlisted
	// provider — never iframe it; degrade to a plain link, matching the
	// insert path's bookmark fallback.
	if (!embedUrl) {
		return (
			<div className="notes__embed" data-kind={EmbedKind.Bookmark}>
				<a href={url} target="_blank" rel="noreferrer noopener" className="notes__embed-link">
					{url}
				</a>
			</div>
		);
	}
	// iframe-src-exempt — Web-embed nodes intentionally load a remote URL
	// (YouTube / Vimeo / etc.); this is the explicit non-opaque-origin case
	// the block-frame primitive does NOT cover (block-frame is srcdoc-only
	// for BP blocks; web embeds are user-supplied URLs).
	return (
		<div className="notes__embed" data-kind={kind}>
			<iframe
				className="notes__embed-frame"
				// iframe-src-exempt
				src={embedUrl}
				title={url}
				loading="lazy"
				referrerPolicy="no-referrer"
				sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
				allow="fullscreen; picture-in-picture; clipboard-write"
			/>
		</div>
	);
}

export function $createWebEmbedNode(
	url: string,
	embedUrl: string | null,
	kind: EmbedKind,
): WebEmbedNode {
	return new WebEmbedNode(url, embedUrl, kind);
}

export function $isWebEmbedNode(node: LexicalNode | null | undefined): node is WebEmbedNode {
	return node instanceof WebEmbedNode;
}
