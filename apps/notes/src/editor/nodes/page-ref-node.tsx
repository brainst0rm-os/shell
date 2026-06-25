/**
 * PageRefNode — a block-level reference to another vault entity (a
 * "sub-page"): icon + title, rendered as an `<a href="brainstorm://
 * entity/<id>">` so the editor's existing link-click interceptor routes
 * the open through the shared `openEntity` intent (same path as the
 * launcher / mentions). No new navigation surface.
 *
 * Relationship semantics: a *flat reference*, not a structural
 * parent/child — it deliberately does not touch the data model. (Graph
 * edge emission for page-refs needs the shell-side body walker to also
 * scan this node type, mirroring how MentionNode edges work; that is a
 * coordinated shell follow-up, intentionally not bundled here.)
 *
 * Persisted shape mirrors MentionNode (`entityId` / `entityType` /
 * `label`) so a later walker update is a one-line addition.
 */

import {
	DecoratorNode,
	type EditorConfig,
	type LexicalNode,
	type NodeKey,
	type SerializedLexicalNode,
} from "lexical";
import type { JSX } from "react";
import { useSyncExternalStore } from "react";
import { t } from "../../i18n/t";
import {
	entityIconsSnapshot,
	getEntityIcon,
	subscribeEntityIcons,
} from "../../store/entity-icon-index";
import {
	entityTitlesSnapshot,
	getEntityTitle,
	subscribeEntityTitles,
} from "../../store/entity-title-index";
import { EntityIcon } from "../../ui/entity-icon";

export const PAGE_REF_NODE_TYPE = "page-ref";
const PAGE_REF_NODE_VERSION = 1 as const;

export type SerializedPageRefNode = SerializedLexicalNode & {
	type: typeof PAGE_REF_NODE_TYPE;
	version: typeof PAGE_REF_NODE_VERSION;
	entityId: string;
	entityType: string;
	label: string;
};

export class PageRefNode extends DecoratorNode<JSX.Element> {
	__entityId: string;
	__entityType: string;
	__label: string;

	static override getType(): string {
		return PAGE_REF_NODE_TYPE;
	}

	static override clone(node: PageRefNode): PageRefNode {
		return new PageRefNode(node.__entityId, node.__entityType, node.__label, node.__key);
	}

	constructor(entityId: string, entityType: string, label: string, key?: NodeKey) {
		super(key);
		this.__entityId = entityId;
		this.__entityType = entityType;
		this.__label = label;
	}

	static override importJSON(s: SerializedPageRefNode): PageRefNode {
		return new PageRefNode(
			typeof s.entityId === "string" ? s.entityId : "",
			typeof s.entityType === "string" ? s.entityType : "",
			typeof s.label === "string" ? s.label : "",
		);
	}

	override exportJSON(): SerializedPageRefNode {
		return {
			type: PAGE_REF_NODE_TYPE,
			version: PAGE_REF_NODE_VERSION,
			entityId: this.__entityId,
			entityType: this.__entityType,
			label: this.__label,
		};
	}

	override createDOM(_config: EditorConfig): HTMLElement {
		const el = document.createElement("div");
		el.className = "notes__pageref-host";
		return el;
	}

	override updateDOM(): false {
		return false;
	}

	getEntityId(): string {
		return this.__entityId;
	}

	override getTextContent(): string {
		return this.__label;
	}

	override isInline(): false {
		return false;
	}

	override decorate(): JSX.Element {
		return (
			<PageRefView entityId={this.__entityId} entityType={this.__entityType} label={this.__label} />
		);
	}
}

function PageRefView({
	entityId,
	entityType,
	label,
}: {
	entityId: string;
	entityType: string;
	label: string;
}) {
	useSyncExternalStore(subscribeEntityIcons, entityIconsSnapshot);
	useSyncExternalStore(subscribeEntityTitles, entityTitlesSnapshot);
	const liveTitle = getEntityTitle(entityId);
	const display = liveTitle?.trim() || label.trim() || t("notes.pageRef.untitled");
	const icon = getEntityIcon(entityId);
	return (
		<a
			className="notes__pageref"
			href={`brainstorm://entity/${entityId}`}
			data-entity-id={entityId}
			data-entity-type={entityType}
		>
			<EntityIcon icon={icon} size={18} className="notes__pageref-icon" />
			<span className="notes__pageref-title">{display}</span>
		</a>
	);
}

export function $createPageRefNode(
	entityId: string,
	entityType: string,
	label: string,
): PageRefNode {
	return new PageRefNode(entityId, entityType, label);
}

export function $isPageRefNode(node: LexicalNode | null | undefined): node is PageRefNode {
	return node instanceof PageRefNode;
}
