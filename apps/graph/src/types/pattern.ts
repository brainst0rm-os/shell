/**
 * Graph patterns — the multi-subject, multi-edge filter shape per
 * . This is the differentiator vs
 * the Database app's row-shaped predicate filter: a pattern lets the user
 * select "Persons connected to each other via a shared School *and* both
 * linked to City=Berlin" — a query the row-filtering language cannot
 * express.
 *
 * Stage 9.13.1 ships the surface; 9.13.3 compiles it to SQL.
 */

import type { Icon } from "./icon";
import type { PropertyPredicate } from "./predicate";

export enum SubjectKind {
	Entity = "entity",
}

export type Subject = {
	kind: SubjectKind.Entity;
	/** Entity type URLs an entity must have to bind this subject. Empty = any type. */
	types: string[];
	/** Property constraint — null means no property constraint, type-only match. */
	where: PropertyPredicate | null;
	/** UI-only display name (the binding name is the map key in GraphPattern.subjects). */
	displayName: string;
	color: string | null;
	icon: Icon | null;
	/** Hard limit on the number of nodes this subject contributes; null = no cap (caps to MEMBERS_HARD_CAP). */
	limit: number | null;
};

export enum EdgeMatch {
	Required = "required",
	Optional = "optional",
	Forbidden = "forbidden",
}

export enum EdgeDirection {
	Out = "out",
	In = "in",
	Both = "both",
}

export type Hops = readonly [min: number, max: number];

export type EdgeConstraint = {
	/** Subject binding name in GraphPattern.subjects */
	from: string;
	/** Subject binding name in GraphPattern.subjects */
	to: string;
	/** Link type URLs the edge may carry. Empty = any link type (expensive). */
	linkTypes: string[];
	direction: EdgeDirection;
	match: EdgeMatch;
	/** [min, max] hops; [1, 1] = single hop (default); [0, 0] = identity (same entity). */
	hops: Hops;
};

export type GraphPattern = {
	subjects: Record<string, Subject>;
	edges: EdgeConstraint[];
	/** Cosmetic only — which subject's name to surface in the renderer's group label. */
	primarySubject: string;
};

/** Per-pattern hard caps per §Hard caps. */
export const PATTERN_MAX_SUBJECTS = 16 as const;
export const PATTERN_MAX_EDGES = 32 as const;
export const PATTERN_MAX_HOPS = 6 as const;
