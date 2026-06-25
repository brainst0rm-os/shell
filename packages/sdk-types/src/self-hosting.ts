/**
 * Self-hosting entity types (SH-5 per).
 *
 * Type-level contract for the four vault-level entity types that turn
 * Brainstorm's own project state — the implementation plan, OQ ledger,
 * docs, stage tracker — into first-party entities the existing apps
 * (Tasks / Database / Graph / Notes) render without bespoke chrome.
 *
 * Persistence + seeding land at SH-6 (a new `BrainstormProject` scope on
 * `vault.seed_demo`). Until then the four shapes here are the only
 * contract callers depend on.
 */

import { enumGuard } from "./enum-guard";

export enum IterationStatus {
	Done = "done",
	Partial = "partial",
	Pending = "pending",
	Reverted = "reverted",
	Unknown = "unknown",
}

export const ITERATION_STATUSES: readonly IterationStatus[] = Object.freeze([
	IterationStatus.Done,
	IterationStatus.Partial,
	IterationStatus.Pending,
	IterationStatus.Reverted,
	IterationStatus.Unknown,
]);

export enum OpenQuestionStatus {
	Open = "open",
	Resolved = "resolved",
}

export const OPEN_QUESTION_STATUSES: readonly OpenQuestionStatus[] = Object.freeze([
	OpenQuestionStatus.Open,
	OpenQuestionStatus.Resolved,
]);

export enum ReleaseStatus {
	InProgress = "in-progress",
	Shipped = "shipped",
}

export const RELEASE_STATUSES: readonly ReleaseStatus[] = Object.freeze([
	ReleaseStatus.InProgress,
	ReleaseStatus.Shipped,
]);

export enum DesignDocCategory {
	Foundations = "foundations",
	Apps = "apps",
	Shell = "shell",
	Data = "data",
	Editing = "editing",
	Security = "security",
	Platform = "platform",
	Reference = "reference",
	Art = "art",
}

export const DESIGN_DOC_CATEGORIES: readonly DesignDocCategory[] = Object.freeze([
	DesignDocCategory.Foundations,
	DesignDocCategory.Apps,
	DesignDocCategory.Shell,
	DesignDocCategory.Data,
	DesignDocCategory.Editing,
	DesignDocCategory.Security,
	DesignDocCategory.Platform,
	DesignDocCategory.Reference,
	DesignDocCategory.Art,
]);

export interface IterationEntity {
	/** Opaque id; conventionally a slug of the iteration code, e.g. `iter-9-14-1`. */
	id: string;
	/** Iteration code from the plan, e.g. `9.14.1.5`, `SH-1`, `B6.4`. */
	code: string;
	/** Stage id the iteration belongs to (`0`, `9`, `9a`, …). */
	stageId: string;
	title: string;
	status: IterationStatus;
	summary: string;
	/** Resolved iso-date if status is `done`. `null` otherwise. */
	completedAt: number | null;
	/** Linked OQ ids (forward references). */
	resolvedOQs: readonly string[];
	createdAt: number;
	updatedAt: number;
}

export interface OpenQuestionEntity {
	id: string;
	/** Plan-side identifier with prefix: `OQ-34`, `OQ-GR-1`, `OQ-TK-2`. */
	code: string;
	number: number;
	section: string;
	title: string;
	status: OpenQuestionStatus;
	where: string | null;
	question: string | null;
	resolution: string | null;
	resolutionRef: string | null;
	createdAt: number;
	updatedAt: number;
}

export interface StageEntity {
	id: string;
	stageId: string;
	heading: string;
	status: IterationStatus;
	goal: string | null;
	ownerDomain: string | null;
	/** Iteration codes the stage contains, in plan order. */
	iterationCodes: readonly string[];
	exitCriteria: readonly string[];
	createdAt: number;
	updatedAt: number;
}

export interface DesignDocEntity {
	id: string;
	/** Repo-relative path, e.g.. */
	path: string;
	/** Filename slug — the part after the numeric prefix. */
	slug: string;
	category: DesignDocCategory;
	/** Numeric prefix from the filename (`49` for `49-self-hosting.md`). */
	docNumber: number;
	title: string;
	/** First H1 / leading paragraph snippet for previews. */
	excerpt: string;
	/** Cross-doc references this doc emits (other DesignDoc ids). */
	referencedDocs: readonly string[];
	/** Iteration codes this doc directly governs / specifies. */
	governingIterations: readonly string[];
	createdAt: number;
	updatedAt: number;
}

/**
 * The single release this vault tracks (Brainstorm v0.1.0). Exactly one
 * `Release/v1` exists; it is the umbrella every Stage / Milestone hangs off.
 * `targetDate` is the only hand-set date in the whole self-hosting model —
 * the value of `RELEASE_TARGET_DATE`. Every other date is derived.
 */
export interface ReleaseEntity {
	id: string;
	/** Semver, e.g. `0.1.0`. */
	version: string;
	name: string;
	/** Epoch ms — the release target (`RELEASE_TARGET_DATE`). */
	targetDate: number;
	status: ReleaseStatus;
	/** Bullet lines from the plan's "v1 ships" list. */
	scopeIncludes: readonly string[];
	/** Comma-split items from the plan's "v1 explicitly does NOT include" line. */
	scopeExcludes: readonly string[];
	/** Stage entity ids under this release, in plan order. */
	stageIds: readonly string[];
	/** Milestone entity ids under this release, in schedule order. */
	milestoneIds: readonly string[];
	createdAt: number;
	updatedAt: number;
}

/**
 * A dated checkpoint on the path to the release. One per stage-gate plus a
 * final GA milestone (`stageId === null`) sitting exactly on the release
 * target date. `targetDate` is derived by `deriveReleaseSchedule`, not
 * hand-set, so the roadmap stays honest as the plan moves.
 */
export interface MilestoneEntity {
	id: string;
	releaseId: string;
	/** Stage entity id this milestone gates, or `null` for the GA milestone. */
	stageId: string | null;
	name: string;
	/** Epoch ms — derived; monotonic in schedule order; GA == release date. */
	targetDate: number;
	status: IterationStatus;
	summary: string;
	createdAt: number;
	updatedAt: number;
}

export type SelfHostingEntity =
	| IterationEntity
	| OpenQuestionEntity
	| StageEntity
	| DesignDocEntity
	| ReleaseEntity
	| MilestoneEntity;

/* ─── Type identifiers (used in capabilities + entity-type registrations) ── */

export enum SelfHostingEntityType {
	Iteration = "brainstorm/Iteration/v1",
	OpenQuestion = "brainstorm/OpenQuestion/v1",
	Stage = "brainstorm/Stage/v1",
	DesignDoc = "brainstorm/DesignDoc/v1",
	Release = "brainstorm/Release/v1",
	Milestone = "brainstorm/Milestone/v1",
}

export const SELF_HOSTING_ENTITY_TYPES: readonly SelfHostingEntityType[] = Object.freeze([
	SelfHostingEntityType.Iteration,
	SelfHostingEntityType.OpenQuestion,
	SelfHostingEntityType.Stage,
	SelfHostingEntityType.DesignDoc,
	SelfHostingEntityType.Release,
	SelfHostingEntityType.Milestone,
]);

/* ─── JSON schemas (frozen; apps reference these in their manifests) ────── */

export const ITERATION_JSON_SCHEMA = Object.freeze({
	$id: SelfHostingEntityType.Iteration,
	type: "object",
	required: ["id", "code", "stageId", "title", "status", "createdAt", "updatedAt"],
	properties: {
		id: { type: "string" },
		code: { type: "string" },
		stageId: { type: "string" },
		title: { type: "string" },
		status: { type: "string", enum: ITERATION_STATUSES as string[] },
		summary: { type: "string" },
		completedAt: { type: ["number", "null"] },
		resolvedOQs: { type: "array", items: { type: "string" } },
		createdAt: { type: "number" },
		updatedAt: { type: "number" },
	},
});

export const OPEN_QUESTION_JSON_SCHEMA = Object.freeze({
	$id: SelfHostingEntityType.OpenQuestion,
	type: "object",
	required: ["id", "code", "number", "section", "title", "status", "createdAt", "updatedAt"],
	properties: {
		id: { type: "string" },
		code: { type: "string" },
		number: { type: "number" },
		section: { type: "string" },
		title: { type: "string" },
		status: { type: "string", enum: OPEN_QUESTION_STATUSES as string[] },
		where: { type: ["string", "null"] },
		question: { type: ["string", "null"] },
		resolution: { type: ["string", "null"] },
		resolutionRef: { type: ["string", "null"] },
		createdAt: { type: "number" },
		updatedAt: { type: "number" },
	},
});

export const STAGE_JSON_SCHEMA = Object.freeze({
	$id: SelfHostingEntityType.Stage,
	type: "object",
	required: ["id", "stageId", "heading", "status", "createdAt", "updatedAt"],
	properties: {
		id: { type: "string" },
		stageId: { type: "string" },
		heading: { type: "string" },
		status: { type: "string", enum: ITERATION_STATUSES as string[] },
		goal: { type: ["string", "null"] },
		ownerDomain: { type: ["string", "null"] },
		iterationCodes: { type: "array", items: { type: "string" } },
		exitCriteria: { type: "array", items: { type: "string" } },
		createdAt: { type: "number" },
		updatedAt: { type: "number" },
	},
});

export const DESIGN_DOC_JSON_SCHEMA = Object.freeze({
	$id: SelfHostingEntityType.DesignDoc,
	type: "object",
	required: ["id", "path", "slug", "category", "docNumber", "title", "createdAt", "updatedAt"],
	properties: {
		id: { type: "string" },
		path: { type: "string" },
		slug: { type: "string" },
		category: { type: "string", enum: DESIGN_DOC_CATEGORIES as string[] },
		docNumber: { type: "number" },
		title: { type: "string" },
		excerpt: { type: "string" },
		referencedDocs: { type: "array", items: { type: "string" } },
		governingIterations: { type: "array", items: { type: "string" } },
		createdAt: { type: "number" },
		updatedAt: { type: "number" },
	},
});

export const RELEASE_JSON_SCHEMA = Object.freeze({
	$id: SelfHostingEntityType.Release,
	type: "object",
	required: ["id", "version", "name", "targetDate", "status", "createdAt", "updatedAt"],
	properties: {
		id: { type: "string" },
		version: { type: "string" },
		name: { type: "string" },
		targetDate: { type: "number" },
		status: { type: "string", enum: RELEASE_STATUSES as string[] },
		scopeIncludes: { type: "array", items: { type: "string" } },
		scopeExcludes: { type: "array", items: { type: "string" } },
		stageIds: { type: "array", items: { type: "string" } },
		milestoneIds: { type: "array", items: { type: "string" } },
		createdAt: { type: "number" },
		updatedAt: { type: "number" },
	},
});

export const MILESTONE_JSON_SCHEMA = Object.freeze({
	$id: SelfHostingEntityType.Milestone,
	type: "object",
	required: ["id", "releaseId", "name", "targetDate", "status", "createdAt", "updatedAt"],
	properties: {
		id: { type: "string" },
		releaseId: { type: "string" },
		stageId: { type: ["string", "null"] },
		name: { type: "string" },
		targetDate: { type: "number" },
		status: { type: "string", enum: ITERATION_STATUSES as string[] },
		summary: { type: "string" },
		createdAt: { type: "number" },
		updatedAt: { type: "number" },
	},
});

export const SELF_HOSTING_JSON_SCHEMAS: Readonly<Record<SelfHostingEntityType, object>> =
	Object.freeze({
		[SelfHostingEntityType.Iteration]: ITERATION_JSON_SCHEMA,
		[SelfHostingEntityType.OpenQuestion]: OPEN_QUESTION_JSON_SCHEMA,
		[SelfHostingEntityType.Stage]: STAGE_JSON_SCHEMA,
		[SelfHostingEntityType.DesignDoc]: DESIGN_DOC_JSON_SCHEMA,
		[SelfHostingEntityType.Release]: RELEASE_JSON_SCHEMA,
		[SelfHostingEntityType.Milestone]: MILESTONE_JSON_SCHEMA,
	});

/* ─── Predicates (type guards) ─────────────────────────────────────────── */

export const isIterationStatus = enumGuard(ITERATION_STATUSES);
export const isOpenQuestionStatus = enumGuard(OPEN_QUESTION_STATUSES);
export const isReleaseStatus = enumGuard(RELEASE_STATUSES);
export const isDesignDocCategory = enumGuard(DESIGN_DOC_CATEGORIES);
export const isSelfHostingEntityType = enumGuard(SELF_HOSTING_ENTITY_TYPES);
