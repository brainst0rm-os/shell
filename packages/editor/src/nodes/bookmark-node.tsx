/**
 * BookmarkNode — a link rendered as a rich card (favicon + title +
 * description + host). No metadata-fetch service is required: the
 * favicon is loaded best-effort straight from the origin and falls back
 * to a glyph `onerror`; title/description default to the host/URL and
 * are user-editable inline. A future shell-brokered unfurl only has to
 * fill the same optional fields — the node shape already carries them.
 *
 * The card is a real `<a target="_blank" rel="noopener">`, matching how
 * plain external links open (the shell owns external navigation), so no
 * new renderer network surface is introduced.
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
	$getNodeByKey,
	DecoratorNode,
	type EditorConfig,
	type LexicalNode,
	type NodeKey,
	type SerializedLexicalNode,
} from "lexical";
import { type JSX, useCallback, useState } from "react";
import { useEditorT } from "../i18n";
import { GlobeIcon } from "../icons";
import { EmbedKind, classifyUrl, faviconUrl, parseHttpUrl } from "../plugins/embed-providers";
import { $createWebEmbedNode } from "./web-embed-node";

export const BOOKMARK_NODE_TYPE = "bookmark";
const BOOKMARK_NODE_VERSION = 1 as const;

export type SerializedBookmarkNode = SerializedLexicalNode & {
	type: typeof BOOKMARK_NODE_TYPE;
	version: typeof BOOKMARK_NODE_VERSION;
	url: string;
	title: string;
	description: string;
};

export class BookmarkNode extends DecoratorNode<JSX.Element> {
	__url: string;
	__title: string;
	__description: string;

	static override getType(): string {
		return BOOKMARK_NODE_TYPE;
	}

	static override clone(node: BookmarkNode): BookmarkNode {
		return new BookmarkNode(node.__url, node.__title, node.__description, node.__key);
	}

	constructor(url: string, title = "", description = "", key?: NodeKey) {
		super(key);
		this.__url = url;
		this.__title = title;
		this.__description = description;
	}

	static override importJSON(s: SerializedBookmarkNode): BookmarkNode {
		return new BookmarkNode(s.url, s.title ?? "", s.description ?? "");
	}

	override exportJSON(): SerializedBookmarkNode {
		return {
			type: BOOKMARK_NODE_TYPE,
			version: BOOKMARK_NODE_VERSION,
			url: this.__url,
			title: this.__title,
			description: this.__description,
		};
	}

	override createDOM(_config: EditorConfig): HTMLElement {
		const el = document.createElement("div");
		el.className = "notes__bookmark-host";
		return el;
	}

	override updateDOM(): false {
		return false;
	}

	getUrl(): string {
		return this.__url;
	}

	setUrl(url: string): void {
		this.getWritable().__url = url;
	}

	setMeta(title: string, description: string): void {
		const w = this.getWritable();
		w.__title = title;
		w.__description = description;
	}

	override decorate(): JSX.Element {
		return (
			<BookmarkView
				nodeKey={this.getKey()}
				url={this.__url}
				title={this.__title}
				description={this.__description}
			/>
		);
	}

	override isInline(): false {
		return false;
	}
}

function BookmarkView({
	nodeKey,
	url,
	title,
	description,
}: {
	nodeKey: NodeKey;
	url: string;
	title: string;
	description: string;
}) {
	const t = useEditorT();
	const host = parseHttpUrl(url)?.hostname.replace(/^www\./, "") ?? url;
	const favicon = faviconUrl(url);
	const [editor] = useLexicalComposerContext();
	// A freshly slash-inserted bookmark has no URL yet — open straight
	// into the editor so the URL field is the first thing focused.
	const [editing, setEditing] = useState(url.trim().length === 0);
	const [draftUrl, setDraftUrl] = useState(url);
	const [draftTitle, setDraftTitle] = useState(title);
	const [draftDesc, setDraftDesc] = useState(description);
	const embeddable = (() => {
		const c = classifyUrl(url);
		return c && c.kind !== EmbedKind.Bookmark && c.embedUrl
			? { embedUrl: c.embedUrl, kind: c.kind }
			: null;
	})();

	const commit = useCallback(() => {
		const nextUrl = draftUrl.trim();
		editor.update(() => {
			const node = $getNodeByKey(nodeKey);
			if (!$isBookmarkNode(node)) return;
			node.setUrl(nextUrl);
			node.setMeta(draftTitle.trim(), draftDesc.trim());
		});
		setEditing(false);
	}, [editor, nodeKey, draftUrl, draftTitle, draftDesc]);

	const convertToEmbed = useCallback(() => {
		if (!embeddable) return;
		editor.update(() => {
			const node = $getNodeByKey(nodeKey);
			if ($isBookmarkNode(node)) {
				node.replace($createWebEmbedNode(url, embeddable.embedUrl, embeddable.kind));
			}
		});
	}, [editor, nodeKey, url, embeddable]);

	if (editing) {
		return (
			<div className="notes__bookmark notes__bookmark--editing">
				<input
					className="notes__bookmark-input"
					type="url"
					value={draftUrl}
					placeholder={t("editor.bookmark.urlPlaceholder")}
					aria-label={t("editor.bookmark.urlPlaceholder")}
					onChange={(e) => setDraftUrl(e.target.value)}
				/>
				<input
					className="notes__bookmark-input"
					value={draftTitle}
					placeholder={t("editor.bookmark.titlePlaceholder")}
					aria-label={t("editor.bookmark.titlePlaceholder")}
					onChange={(e) => setDraftTitle(e.target.value)}
				/>
				<textarea
					className="notes__bookmark-input notes__bookmark-input--desc"
					value={draftDesc}
					placeholder={t("editor.bookmark.descPlaceholder")}
					aria-label={t("editor.bookmark.descPlaceholder")}
					onChange={(e) => setDraftDesc(e.target.value)}
				/>
				<div className="notes__bookmark-actions">
					<button
						type="button"
						className="notes__bookmark-btn notes__bookmark-btn--primary"
						onClick={commit}
					>
						{t("editor.bookmark.save")}
					</button>
					<button type="button" className="notes__bookmark-btn" onClick={() => setEditing(false)}>
						{t("editor.bookmark.cancel")}
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="notes__bookmark">
			<a
				className="notes__bookmark-link"
				href={url}
				target="_blank"
				rel="noopener noreferrer nofollow"
			>
				<span className="notes__bookmark-text">
					<span className="notes__bookmark-title">{title.trim() || host}</span>
					{description.trim() && <span className="notes__bookmark-desc">{description}</span>}
					<span className="notes__bookmark-host">
						{favicon ? (
							<img
								className="notes__bookmark-favicon"
								src={favicon}
								alt=""
								width={16}
								height={16}
								onError={(e) => {
									e.currentTarget.style.display = "none";
									e.currentTarget.nextElementSibling?.removeAttribute("hidden");
								}}
							/>
						) : null}
						<span className="notes__bookmark-favicon-fallback" hidden aria-hidden="true">
							<GlobeIcon />
						</span>
						{host}
					</span>
				</span>
			</a>
			<div className="notes__bookmark-tools">
				{embeddable && (
					<button
						type="button"
						className="notes__bookmark-edit"
						aria-label={t("editor.bookmark.convertEmbed")}
						title={t("editor.bookmark.convertEmbed")}
						onClick={convertToEmbed}
					>
						{t("editor.bookmark.convertEmbed")}
					</button>
				)}
				<button
					type="button"
					className="notes__bookmark-edit"
					aria-label={t("editor.bookmark.edit")}
					title={t("editor.bookmark.edit")}
					onClick={() => {
						setDraftUrl(url);
						setDraftTitle(title);
						setDraftDesc(description);
						setEditing(true);
					}}
				>
					{t("editor.bookmark.edit")}
				</button>
			</div>
		</div>
	);
}

export function $createBookmarkNode(url: string, title = "", description = ""): BookmarkNode {
	return new BookmarkNode(url, title, description);
}

export function $isBookmarkNode(node: LexicalNode | null | undefined): node is BookmarkNode {
	return node instanceof BookmarkNode;
}
