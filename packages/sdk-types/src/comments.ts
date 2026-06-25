/**
 * Comments + suggestions contract (`brainstorm/Comment/v1`) — the B11.9
 * collaboration-overlays data leaf, per
 * §Comments and (annotations are entities, not
 * editor-only state, so they get the shared backlinks / Graph / sync treatment
 * every other entity does).
 *
 * A comment is anchored to a **block** within a host document (the durable
 * anchor that survives text edits — a raw character range would dangle the
 * moment the block is re-typed), optionally carrying the quoted text the
 * author selected so the UI can show context even after the block changes. A
 * thread is a root comment plus its replies (`parentId`); resolving the root
 * resolves the thread. A **suggestion** is the same shape with `kind:
 * Suggestion` + a `suggestion` payload describing a proposed edit that an
 * accept/reject workflow applies (the apply/resolve engine is a later rung;
 * the shape is frozen here so the union is stable).
 *
 * Pure contract leaf: only the `enum-guard` leaf is imported, so this barrel
 * re-exports with no cycle. Entity ids are plain `string`s here (not the
 * `index.ts` `EntityId` alias) to keep the leaf dependency-free.
 */

import { enumGuard } from "./enum-guard";

export const COMMENT_TYPE_URL = "brainstorm/Comment/v1";

/** Local alias for an entity id — a plain `string` so this leaf stays
 *  dependency-free (mirrors the automations leaf). */
type Id = string;

export enum CommentKind {
	Comment = "comment",
	Suggestion = "suggestion",
}
export const COMMENT_KINDS = Object.freeze([CommentKind.Comment, CommentKind.Suggestion] as const);
export const isCommentKind = enumGuard(COMMENT_KINDS);

/** Derived open/resolved status — a function of `resolvedAt`, never stored
 *  separately (so the two can't drift). */
export enum CommentStatus {
	Open = "open",
	Resolved = "resolved",
}

/** A block-anchored annotation target. `blockId` is the editor's stable block
 *  id (`__bsId`, minted by `mintBlockId`); `quote` is the selected text at
 *  authoring time, shown as context and used to re-find the anchor if the
 *  block id is ever lost. `range` narrows the anchor within the block when the
 *  author selected a sub-span (best-effort — the block id is the source of
 *  truth). */
export type CommentAnchor = {
	/** The host document entity the comment lives on. */
	entityId: Id;
	/** The editor block id within that document. */
	blockId: string;
	/** The text selected when the comment was created (context + re-find). */
	quote?: string;
	/** Optional sub-block character range (relative to the block's text). */
	range?: { start: number; end: number };
};

/** A proposed edit carried by a `kind: Suggestion` comment. `replacement`
 *  replaces the anchored `quote`; an empty replacement is a deletion. The
 *  accept/reject engine is a later rung — this freezes the shape. */
export type CommentSuggestion = {
	replacement: string;
};

export type CommentDef = {
	id: Id;
	kind: CommentKind;
	anchor: CommentAnchor;
	/** Plain-text body — the canonical, searchable, agent-readable text. Always
	 *  present (the rich body's flattening when one exists). */
	body: string;
	/** Serialized Lexical `EditorState` (JSON) when the comment was authored in
	 *  the rich CompactEditor. Optional: legacy / plain comments have only
	 *  `body`. Renderers prefer `richBody` and fall back to `body`. */
	richBody?: string;
	/** Root of the thread, or `null` for a top-level comment. */
	parentId: Id | null;
	/** Display name of the author at authoring time (denormalized, like peer
	 *  presence — identity-backed naming is a follow-up). */
	authorName?: string;
	/** Author identity id when known (the vault's Ed25519 identity). */
	authorId?: Id;
	createdAt: number;
	updatedAt: number;
	/** Epoch ms when the thread was resolved, or `null` while open. Only
	 *  meaningful on a root comment; a reply inherits the root's status. */
	resolvedAt: number | null;
	/** Present only when `kind === Suggestion`. */
	suggestion?: CommentSuggestion;
	/** Sovereign pubkeys (`RosterMember.pubkey`) of people @-mentioned in the
	 *  comment body — the notification targets (Collab-C6). Absent / empty when
	 *  no one was mentioned. */
	mentions?: string[];
};

export enum CommentIssueCode {
	EmptyBody = "empty-body",
	MissingEntityRef = "missing-entity-ref",
	MissingBlockRef = "missing-block-ref",
	InvalidKind = "invalid-kind",
	InvalidRange = "invalid-range",
	MissingSuggestion = "missing-suggestion",
	ReplyCannotResolve = "reply-cannot-resolve",
}

export type CommentIssue = { code: CommentIssueCode; message: string };

export function validateComment(def: CommentDef): CommentIssue[] {
	const issues: CommentIssue[] = [];
	if (def.body.trim().length === 0) {
		issues.push({ code: CommentIssueCode.EmptyBody, message: "Comment body is empty." });
	}
	if (!isCommentKind(def.kind)) {
		issues.push({
			code: CommentIssueCode.InvalidKind,
			message: `Unknown comment kind '${def.kind}'.`,
		});
	}
	if (def.anchor.entityId.length === 0) {
		issues.push({
			code: CommentIssueCode.MissingEntityRef,
			message: "Comment anchor has no entity id.",
		});
	}
	if (def.anchor.blockId.length === 0) {
		issues.push({
			code: CommentIssueCode.MissingBlockRef,
			message: "Comment anchor has no block id.",
		});
	}
	const range = def.anchor.range;
	if (range !== undefined && (range.start < 0 || range.end < range.start)) {
		issues.push({
			code: CommentIssueCode.InvalidRange,
			message: "Comment anchor range is malformed.",
		});
	}
	if (def.kind === CommentKind.Suggestion && def.suggestion === undefined) {
		issues.push({
			code: CommentIssueCode.MissingSuggestion,
			message: "Suggestion comment has no proposed edit.",
		});
	}
	// Only a thread root carries resolution; a reply inherits the root's status.
	if (def.parentId !== null && def.resolvedAt !== null) {
		issues.push({
			code: CommentIssueCode.ReplyCannotResolve,
			message: "A reply cannot be resolved independently of its thread.",
		});
	}
	return issues;
}

export const isValidComment = (def: CommentDef): boolean => validateComment(def).length === 0;

export function commentStatus(def: CommentDef): CommentStatus {
	return def.resolvedAt === null ? CommentStatus.Open : CommentStatus.Resolved;
}

/** Stable thread-grouping key for an anchor (entity + block). Two comments on
 *  the same block belong to the same anchor group even if they start separate
 *  threads. */
export function threadKeyFor(anchor: CommentAnchor): string {
	return `${anchor.entityId}#${anchor.blockId}`;
}

export type CommentThread = {
	root: CommentDef;
	replies: CommentDef[];
	status: CommentStatus;
};

/** Build threads from a flat comment list: each top-level comment (`parentId
 *  === null`) is a root; replies attach to their root (sorted oldest-first); a
 *  reply whose root is absent is promoted to its own root so nothing is
 *  dropped. Roots are sorted oldest-first. The thread status is the root's. */
export function buildThreads(comments: readonly CommentDef[]): CommentThread[] {
	const byId = new Map<Id, CommentDef>();
	for (const c of comments) byId.set(c.id, c);
	const roots: CommentDef[] = [];
	const repliesByRoot = new Map<Id, CommentDef[]>();
	for (const c of comments) {
		const isRoot = c.parentId === null || !byId.has(c.parentId);
		if (isRoot) {
			roots.push(c);
		} else {
			const list = repliesByRoot.get(c.parentId as Id) ?? [];
			list.push(c);
			repliesByRoot.set(c.parentId as Id, list);
		}
	}
	const byCreatedAt = (a: CommentDef, b: CommentDef): number => a.createdAt - b.createdAt;
	return roots
		.slice()
		.sort(byCreatedAt)
		.map((root) => ({
			root,
			replies: (repliesByRoot.get(root.id) ?? []).slice().sort(byCreatedAt),
			status: commentStatus(root),
		}));
}

/** Count of open (unresolved) threads in a comment list — the gutter / header
 *  badge number. */
export function openThreadCount(comments: readonly CommentDef[]): number {
	return buildThreads(comments).filter((thread) => thread.status === CommentStatus.Open).length;
}

/** All comment ids in a thread (root + replies) — the set to delete / re-anchor
 *  when the root is removed or its block disappears. */
export function threadCommentIds(thread: CommentThread): Id[] {
	return [thread.root.id, ...thread.replies.map((reply) => reply.id)];
}
